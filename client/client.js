#!/usr/bin/env node
import 'dotenv/config';
import inquirer from 'inquirer';
import { SolidNodeClient } from 'solid-node-client';
import {
  getSolidDataset,
  getSolidDatasetWithAcl,
  getResourceAcl,
  createAcl,
  setAgentResourceAccess,
  setAgentDefaultAccess,
  saveAclFor,
  getContainedResourceUrlAll
} from '@inrupt/solid-client';
import { loginWithClientCreds } from './auth.js';
import WebSocketPkg from 'ws';
const WebSocket = WebSocketPkg?.default || WebSocketPkg;

// -------------------- ENV ----------------------------
let CLIENT_INBOX_URL = process.env.CLIENT_INBOX_URL;
const SERVER_URL       = process.env.SERVER_URL       || 'http://localhost:4000';
const POLL_INTERVAL_MS = process.env.POLL_INTERVAL_MS || '10000';

// -------------------- Solid client & auth ----------
const client = new SolidNodeClient();
let session = null;
let loggedIn = false;

/**
 * Perform login via auth module, bind session.fetch
 */
async function login() {
  session = await loginWithClientCreds();
  client.fetch = session.fetch.bind(session);
  loggedIn = true;
}

/**
 * Grant ACL: resource-only access
 */
async function grantFolderAccessWithoutInheritance(folderUrl, agentWebId) {
  const dsWithAcl = await getSolidDatasetWithAcl(folderUrl, { fetch: session.fetch });
  let acl = getResourceAcl(dsWithAcl) || createAcl(dsWithAcl);
  acl = setAgentResourceAccess(acl, agentWebId, { read: true, append: true, write: false, control: false });
  await saveAclFor(dsWithAcl, acl, { fetch: session.fetch });
  console.log(`✅ Granted resource-only access for ${agentWebId}`);
}

/**
 * Grant ACL: resource + default (inheritance)
 */
async function grantFolderAccessWithInheritance(folderUrl, agentWebId) {
  const dsWithAcl = await getSolidDatasetWithAcl(folderUrl, { fetch: session.fetch });
  let acl = getResourceAcl(dsWithAcl) || createAcl(dsWithAcl);
  acl = setAgentResourceAccess(acl, agentWebId, { read: true, append: true, write: false, control: false });
  acl = setAgentDefaultAccess(acl, agentWebId, { read: true, append: true, write: false, control: false });
  await saveAclFor(dsWithAcl, acl, { fetch: session.fetch });
  console.log(`✅ Granted inherited access for ${agentWebId}`);
}

/**
 * Subscribe and set ACLs
 */
async function subscribe() {
  if (!loggedIn) await login();
  const res = await session.fetch(`${SERVER_URL}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inbox: CLIENT_INBOX_URL })
  });
  if (!res.ok) throw new Error(`Subscription failed (${res.status})`);
  const serverWebId = (await res.text()).trim();
  console.log(`🔗 Subscribed OK – server WebID: ${serverWebId}`);
  // Grant ACL
  try {
    await grantFolderAccessWithInheritance(CLIENT_INBOX_URL, serverWebId);
  } catch (e) {
    console.error('❌ ACL inheritance failed, falling back:', e.message);
    await grantFolderAccessWithoutInheritance(CLIENT_INBOX_URL, serverWebId);
  }
}

/**
 * List inbox contents once
 */
async function listInbox(seen = new Set()) {
  if (!loggedIn) await login();
  const ds = await getSolidDataset(CLIENT_INBOX_URL, { fetch: client.fetch });
  const resources = getContainedResourceUrlAll(ds).sort();
  if (resources.length === 0) console.log('(empty inbox)');
  else resources.forEach(url => {
    if (!seen.has(url)) {
      console.log(url);
      seen.add(url);
    }
  });
}

/**
 * Connect WebSocket for real-time pings
 */
function connectWebSocket(pingCallback) {
  if (!WebSocket) {
    console.warn('⚠️ ws not available; using polling only');
    return;
  }
  const wsUrl = SERVER_URL.replace(/^http/, 'ws') + '/ws';
  const ws = new WebSocket(wsUrl);
  ws.on('open', () => console.log('🔌 WS connected'));
  ws.on('message', data => {
    if (data.toString() === 'ping') {
      console.log('🔔 Received ping');
      pingCallback();
    } else {
      console.log('ℹ️ WS message:', data.toString());
    }
  });
  ws.on('close', () => console.log('↪️ WS disconnected'));
  ws.on('error', err => console.error('⚠️ WS error:', err.message));
}

/**
 * Poll + WS watch
 */
async function watchInbox() {
  if (!loggedIn) await login();
  const seen = new Set();
  await listInbox(seen);
  console.log(`👀 Polling every ${POLL_INTERVAL_MS}ms`);
  setInterval(() => listInbox(seen), Number(POLL_INTERVAL_MS));
  connectWebSocket(() => listInbox(seen));
}

/**
 * Interactive menu
 */
async function mainMenu() {
  const opts = ['login','subscribe','list','watch','exit'];
  while (true) {
    const { action } = await inquirer.prompt([{ type: 'list', name: 'action', message: 'Action', choices: [
      { name: loggedIn? 'Re-login':'Login', value:'login' },
      { name: 'Subscribe', value:'subscribe' },
      { name: 'List once', value:'list' },
      { name: 'Watch (poll+WS)', value:'watch' },
      { name: 'Exit', value:'exit' }
    ] }]);
    try {
      if (action==='login')     await login();
      if (action==='subscribe') await subscribe();
      if (action==='list')      await listInbox();
      if (action==='watch')     await watchInbox();
      if (action==='exit')      { console.log('👋 Bye'); process.exit(0); }
    } catch(e) { console.error('❌',e.message); }
  }
}

mainMenu();
