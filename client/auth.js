#!/usr/bin/env node
import 'dotenv/config';                          // ← must be first: loads your .env

import { Session } from '@inrupt/solid-client-authn-node';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';

/** Prompt the user for token ID & secret if missing. */
async function promptCredentials() {
  const rl = readline.createInterface({ input, output });
  const clientId     = await rl.question('Enter your Token Identifier: ');
  const clientSecret = await rl.question('Enter your Token Secret: ');
  rl.close();
  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim()
  };
}

/**
 * Client Credentials login (no browser):
 * 1) Try env vars
 * 2) Fallback to prompt
 * 3) Return a logged-in Session
 */
export async function loginWithClientCreds() {
  let clientId     = process.env.CLIENT_TOKEN_ID;
  let clientSecret = process.env.CLIENT_TOKEN_SECRET;
  const oidcIssuer = process.env.OIDC_ISSUER || 'https://solidcommunity.net';

  if (!clientId || !clientSecret) {
    console.log('🔑 Client ID/Secret not found in .env, please enter manually:');
    const creds = await promptCredentials();
    clientId     = creds.clientId;
    clientSecret = creds.clientSecret;
  }

  const session = new Session();
  await session.login({ oidcIssuer, clientId, clientSecret });

  if (!session.info.isLoggedIn) {
    throw new Error('Authentication failed – check credentials');
  }
  console.log(`✅ Logged in as ${session.info.webId}`);
  return session;
}
