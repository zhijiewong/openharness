import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AgentMessageBus } from './agent-messaging.js';

describe('AgentMessageBus', () => {
  let bus: AgentMessageBus;

  beforeEach(() => {
    bus = new AgentMessageBus();
    bus.registerAgent('agent-1', 'code-reviewer');
    bus.registerAgent('agent-2', 'test-writer');
  });

  describe('messaging', () => {
    it('sends and receives messages', () => {
      bus.send({ from: 'agent-1', to: 'agent-2', type: 'request', content: 'review file.ts' });
      const msgs = bus.receive('agent-2');
      assert.strictEqual(msgs.length, 1);
      assert.strictEqual(msgs[0]!.content, 'review file.ts');
      assert.strictEqual(msgs[0]!.from, 'agent-1');
    });

    it('drains inbox on receive', () => {
      bus.send({ from: 'agent-1', to: 'agent-2', type: 'request', content: 'hello' });
      bus.receive('agent-2');
      const msgs = bus.receive('agent-2');
      assert.strictEqual(msgs.length, 0);
    });

    it('peek does not drain', () => {
      bus.send({ from: 'agent-1', to: 'agent-2', type: 'request', content: 'hello' });
      const peeked = bus.peek('agent-2');
      assert.strictEqual(peeked.length, 1);
      const received = bus.receive('agent-2');
      assert.strictEqual(received.length, 1);
    });

    it('broadcasts to all except sender', () => {
      bus.registerAgent('agent-3', 'debugger');
      bus.send({ from: 'agent-1', to: '*', type: 'status', content: 'done with task A' });
      assert.strictEqual(bus.receive('agent-2').length, 1);
      assert.strictEqual(bus.receive('agent-3').length, 1);
      assert.strictEqual(bus.receive('agent-1').length, 0); // sender doesn't get it
    });
  });

  describe('agent registry', () => {
    it('lists registered agents', () => {
      const agents = bus.getAgents();
      assert.strictEqual(agents.length, 2);
      assert.ok(agents.find(a => a.id === 'agent-1'));
    });

    it('updates agent status', () => {
      bus.updateStatus('agent-1', 'working', 'task-42');
      const agent = bus.getAgent('agent-1');
      assert.strictEqual(agent?.status, 'working');
      assert.strictEqual(agent?.currentTask, 'task-42');
    });

    it('unregisters agent and cleans up', () => {
      bus.send({ from: 'agent-1', to: 'agent-2', type: 'request', content: 'hello' });
      bus.unregisterAgent('agent-2');
      assert.strictEqual(bus.getAgent('agent-2'), undefined);
    });
  });

  describe('file locking', () => {
    it('acquires and releases locks', () => {
      assert.strictEqual(bus.acquireLock('agent-1', 'src/file.ts'), true);
      assert.strictEqual(bus.isLocked('src/file.ts').locked, true);
      assert.strictEqual(bus.isLocked('src/file.ts').holder, 'agent-1');
      bus.releaseLock('agent-1', 'src/file.ts');
      assert.strictEqual(bus.isLocked('src/file.ts').locked, false);
    });

    it('prevents double-locking by different agent', () => {
      bus.acquireLock('agent-1', 'src/file.ts');
      assert.strictEqual(bus.acquireLock('agent-2', 'src/file.ts'), false);
    });

    it('allows same agent to re-lock', () => {
      bus.acquireLock('agent-1', 'src/file.ts');
      assert.strictEqual(bus.acquireLock('agent-1', 'src/file.ts'), true);
    });

    it('releaseAllLocks clears agent locks', () => {
      bus.acquireLock('agent-1', 'a.ts');
      bus.acquireLock('agent-1', 'b.ts');
      bus.releaseAllLocks('agent-1');
      assert.strictEqual(bus.isLocked('a.ts').locked, false);
      assert.strictEqual(bus.isLocked('b.ts').locked, false);
    });

    it('unregister releases locks', () => {
      bus.acquireLock('agent-1', 'src/file.ts');
      bus.unregisterAgent('agent-1');
      assert.strictEqual(bus.isLocked('src/file.ts').locked, false);
    });
  });
});
