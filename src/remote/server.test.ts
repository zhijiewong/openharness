import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { RemoteServer } from './server.js';
import { createMockProvider, textResponseEvents, createMockTool } from '../test-helpers.js';

const provider = createMockProvider([textResponseEvents('Hello remote!')]);
const tools = [createMockTool('TestTool')];

let server: RemoteServer;
let port: number;

// Use a random port for each test run
function getRandomPort(): number {
  return 30000 + Math.floor(Math.random() * 10000);
}

function httpGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    }).on('error', reject);
  });
}

function httpPost(path: string, data: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(`http://localhost:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let resBody = '';
      res.on('data', (chunk) => resBody += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, body: resBody }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('remote server: GET /status returns 200', async () => {
  port = getRandomPort();
  server = new RemoteServer({
    port,
    provider,
    tools,
    systemPrompt: 'test',
    permissionMode: 'trust',
    model: 'mock',
  });
  await server.start();

  try {
    const res = await httpGet('/status');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.status, 'ok');
    assert.equal(data.provider, 'mock');
  } finally {
    server.stop();
  }
});

test('remote server: unknown endpoint returns 404', async () => {
  port = getRandomPort();
  server = new RemoteServer({
    port,
    provider,
    tools,
    systemPrompt: 'test',
    permissionMode: 'trust',
  });
  await server.start();

  try {
    const res = await httpGet('/nonexistent');
    assert.equal(res.status, 404);
  } finally {
    server.stop();
  }
});

test('remote server: POST /dispatch with missing prompt returns 400', async () => {
  port = getRandomPort();
  server = new RemoteServer({
    port,
    provider,
    tools,
    systemPrompt: 'test',
    permissionMode: 'trust',
  });
  await server.start();

  try {
    const res = await httpPost('/dispatch', {});
    assert.equal(res.status, 400);
    const data = JSON.parse(res.body);
    assert.ok(data.error.includes('prompt'));
  } finally {
    server.stop();
  }
});

test('remote server: POST /dispatch with prompt returns SSE events', async () => {
  port = getRandomPort();
  const freshProvider = createMockProvider([textResponseEvents('Hi!')]);
  server = new RemoteServer({
    port,
    provider: freshProvider,
    tools,
    systemPrompt: 'test',
    permissionMode: 'trust',
  });
  await server.start();

  try {
    const res = await httpPost('/dispatch', { prompt: 'hello' });
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('data:'));
    assert.ok(res.body.includes('[DONE]'));
  } finally {
    server.stop();
  }
});
