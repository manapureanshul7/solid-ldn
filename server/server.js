#!/usr/bin/env node
// import 'dotenv/config';
// import express from 'express';
// import { Session } from '@inrupt/solid-client-authn-node';
// import chokidar from 'chokidar';
// import path from 'path';
// import fs from 'fs';
// import {
//   overwriteFile
// } from '@inrupt/solid-client';

// // -------------------- ENV ----------------------------
// const SERVER_PORT      = process.env.SERVER_PORT     || 4000;
// const OIDC_ISSUER      = process.env.OIDC_ISSUER     || 'https://solidcommunity.net';
// const POD_ROOT         = process.env.SERVER_POD_ROOT || 'https://server.example/files/';
// // Local weights file path
// const weightsPath      = path.resolve(process.cwd(), 'weights.bin');

// // -------------------- Auth / Solid session ----------
// let session;
// async function initSession() {
//   const clientId     = process.env.SERVER_TOKEN_ID;
//   const clientSecret = process.env.SERVER_TOKEN_SECRET;
//   session = new Session();
//   await session.login({ oidcIssuer: OIDC_ISSUER, clientId, clientSecret });
//   if (!session.info.isLoggedIn) {
//     console.error('❌ Server pod login failed');
//     process.exit(1);
//   }
//   console.log(`✅ Server logged in as ${session.info.webId}`);
// }

// // -------------------- Express app -------------------
// const app = express();
// app.use(express.json());

// // 1) Subscription endpoint
// let registeredInbox = null;
// app.post('/subscribe', (req, res) => {
//   const { inbox } = req.body;
//   if (!inbox) return res.status(400).send('Missing inbox URL');
//   registeredInbox = inbox;
//   res.status(201).send(session.info.webId);
//   console.log(`Client subscribed: ${inbox}`);
// });

// // 2) Simulate update: modify local file and push to Pod
// app.post('/simulate-update', async (req, res) => {
//   try {
//     // Touch local file
//     const now = new Date().toISOString();
//     fs.appendFileSync(weightsPath, `\n# updated at ${now}`);
//     console.log(`weights.bin touched at ${now}`);

//     // Read file contents
//     const content = fs.readFileSync(weightsPath);
//     // Overwrite remote weights.bin on Pod
//     await overwriteFile(`${POD_ROOT}weights.bin`, content, {
//       contentType: 'application/octet-stream',
//       fetch: session.fetch.bind(session)
//     });
//     console.log('✅ Updated weights.bin on server Pod');

//     res.sendStatus(204);
//   } catch (err) {
//     console.error('❌ simulate-update error:', err);
//     res.status(500).send(err.message);
//   }
// });

// // 3) Notify client when local file changes
// async function notifyClient() {
//   if (!registeredInbox) {
//     console.warn('No client inbox registered; skipping notification');
//     return;
//   }
//   const notification = {
//     "@context": ["https://www.w3.org/ns/activitystreams"],
//     type:      'Update',
//     actor:     session.info.webId,
//     object:    `${POD_ROOT}weights.bin`,
//     summary:   'weights.bin was updated',
//     published: new Date().toISOString()
//   };

//   try {
//     const res = await session.fetch(registeredInbox, {
//       method:  'POST',
//       headers: { 'Content-Type': 'application/ld+json' },
//       body:    JSON.stringify(notification)
//     });
//     if (res.ok) console.log('🔔 Notification sent to inbox');
//     else console.error('Failed to POST notification', res.status);
//   } catch (e) {
//     console.error('Error sending notification', e);
//   }
// }

// // Watch local weights.bin
// chokidar.watch(weightsPath, { ignoreInitial: true })
//   .on('add', filePath => {
//     console.log(`➕ weights.bin added: ${filePath}`);
//     notifyClient();
//   })
//   .on('change', filePath => {
//     console.log(`🔄 weights.bin changed: ${filePath}`);
//     notifyClient();
//   })
//   .on('error', err => console.error('Watcher error:', err));

// // -------------------- Bootstrap ----------------------
// (async () => {
//   await initSession();
//   app.listen(SERVER_PORT, () => console.log(`🚀 Server listening on port ${SERVER_PORT}`));
// })();


import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Session } from '@inrupt/solid-client-authn-node';
import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { overwriteFile } from '@inrupt/solid-client';
import { WebSocketServer } from 'ws';

// -------------------- ENV ----------------------------
const SERVER_PORT      = process.env.SERVER_PORT     || 4000;
const OIDC_ISSUER      = process.env.OIDC_ISSUER     || 'https://solidcommunity.net';
const POD_ROOT         = process.env.SERVER_POD_ROOT || 'https://server.example/files/';
// Path to the local weights file
const weightsPath      = path.resolve(process.cwd(), 'weights.bin');

// -------------------- Auth / Solid session ----------
let session;
async function initSession() {
  const clientId     = process.env.SERVER_TOKEN_ID;
  const clientSecret = process.env.SERVER_TOKEN_SECRET;
  session = new Session();
  await session.login({ oidcIssuer: OIDC_ISSUER, clientId, clientSecret });
  if (!session.info.isLoggedIn) {
    console.error('❌ Server pod login failed');
    process.exit(1);
  }
  console.log(`✅ Server logged in as ${session.info.webId}`);
}

// -------------------- Express + WS setup -------------
const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', socket => {
  console.log('🔌 WS client connected');
  socket.on('close', () => console.log('↪️  WS client disconnected'));
});

// Broadcast a ping to all connected WS clients
function broadcastPing() {
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send('ping');
    }
  });
}

// -------------------- Routes -------------------------
let registeredInbox = null;
app.post('/subscribe', (req, res) => {
  const { inbox } = req.body;
  if (!inbox) return res.status(400).send('Missing inbox URL');
  registeredInbox = inbox;
  res.status(201).send(session.info.webId);
  console.log(`Client subscribed: ${inbox}`);
});

app.post('/simulate-update', async (req, res) => {
  try {
    const now = new Date().toISOString();
    fs.appendFileSync(weightsPath, `\n# updated at ${now}`);
    console.log(`🔄 weights.bin touched at ${now}`);

    const content = fs.readFileSync(weightsPath);
    await overwriteFile(`${POD_ROOT}weights.bin`, content, {
      contentType: 'application/octet-stream',
      fetch: session.fetch.bind(session)
    });
    console.log('✅ Updated weights.bin on server Pod');

    res.sendStatus(204);
  } catch (err) {
    console.error('❌ simulate-update error:', err);
    res.status(500).send(err.message);
  }
});

// -------------------- Notification logic -------------
async function notifyClient() {
  if (!registeredInbox) {
    console.warn('⚠️ No client inbox registered; skipping notification');
    return;
  }
  const notification = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    type:      'Update',
    actor:     session.info.webId,
    object:    `${POD_ROOT}weights.bin`,
    summary:   'weights.bin was updated',
    published: new Date().toISOString()
  };

  try {
    const res = await session.fetch(registeredInbox, {
      method:  'POST',
      headers: { 'Content-Type': 'application/ld+json' },
      body:    JSON.stringify(notification)
    });
    if (res.ok) {
      console.log('🔔 Notification sent to inbox');
      broadcastPing();          // real-time ping
    } else {
      console.error('❌ Failed to POST notification', res.status);
    }
  } catch (e) {
    console.error('❌ Error sending notification', e);
  }
}

// Watch local weights.bin for add/change
chokidar.watch(weightsPath, { ignoreInitial: true })
  .on('add',    () => notifyClient())
  .on('change', () => notifyClient())
  .on('error',  err => console.error('Watcher error:', err));

// -------------------- Bootstrap ----------------------
(async () => {
  await initSession();
  server.listen(SERVER_PORT, () => console.log(`🚀 Server listening on port ${SERVER_PORT}`));
})();
