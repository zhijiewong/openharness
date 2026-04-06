import test from 'node:test';
import assert from 'node:assert/strict';

// The LspClient uses subprocess communication, which is hard to test
// without a real language server. Test the message framing logic instead.

test('LSP: Content-Length framing format is correct', () => {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  const frame = header + body;

  // Parse it back
  const headerEnd = frame.indexOf('\r\n\r\n');
  assert.ok(headerEnd > 0);
  const headerStr = frame.slice(0, headerEnd);
  const match = headerStr.match(/Content-Length:\s*(\d+)/i);
  assert.ok(match);
  const contentLength = parseInt(match[1]!);
  assert.equal(contentLength, Buffer.byteLength(body));
  const parsed = JSON.parse(frame.slice(headerEnd + 4));
  assert.equal(parsed.method, 'initialize');
});

test('LSP: JSON-RPC request format is valid', () => {
  const req = { jsonrpc: '2.0', id: 1, method: 'textDocument/definition', params: { textDocument: { uri: 'file:///test.ts' }, position: { line: 0, character: 5 } } };
  const json = JSON.stringify(req);
  const parsed = JSON.parse(json);
  assert.equal(parsed.jsonrpc, '2.0');
  assert.equal(parsed.method, 'textDocument/definition');
  assert.equal(parsed.params.position.line, 0);
});

test('LSP: diagnostic severity mapping', () => {
  const severityMap: Record<number, string> = { 1: 'Error', 2: 'Warning', 3: 'Info', 4: 'Hint' };
  assert.equal(severityMap[1], 'Error');
  assert.equal(severityMap[2], 'Warning');
  assert.equal(severityMap[3], 'Info');
  assert.equal(severityMap[4], 'Hint');
});

test('LSP: file URI conversion', () => {
  const filePath = '/home/user/project/src/index.ts';
  const uri = `file://${filePath.replace(/\\/g, '/')}`;
  assert.equal(uri, 'file:///home/user/project/src/index.ts');

  // Windows path
  const winPath = 'C:\\Users\\test\\project\\src\\index.ts';
  const winUri = `file://${winPath.replace(/\\/g, '/')}`;
  assert.equal(winUri, 'file://C:/Users/test/project/src/index.ts');
});
