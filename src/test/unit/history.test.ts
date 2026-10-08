import * as assert from 'assert';
import { ChangeHistory } from '../../core/ChangeHistory';
import { ChangeOperation } from '../../models/ChangeOperation';
import { ChangeSource } from '../../models/ChangeSource';

describe('ChangeHistory', () => {
  function makeOp(id: string): ChangeOperation {
    return {
      id,
      fileUri: 'file:///test.ts',
      timestamp: Date.now(),
      source: ChangeSource.USER,
      operationType: 'accept-change',
      affectedRanges: [],
      fileSnapshots: [],
      description: `Op ${id}`
    };
  }

  it('should push, peek and pop operations in LIFO order', () => {
    const history = new ChangeHistory(10);
    assert.strictEqual(history.canUndo(), false);

    history.push(makeOp('1'));
    history.push(makeOp('2'));

    assert.strictEqual(history.canUndo(), true);
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history.peek()?.id, '2');

    const popped = history.pop();
    assert.strictEqual(popped?.id, '2');
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history.peek()?.id, '1');
  });

  it('should respect maxDepth limit and discard oldest operations', () => {
    const history = new ChangeHistory(3);
    history.push(makeOp('1'));
    history.push(makeOp('2'));
    history.push(makeOp('3'));
    history.push(makeOp('4'));

    assert.strictEqual(history.length, 3);
    const all = history.getAll();
    assert.deepStrictEqual(all.map((o) => o.id), ['2', '3', '4']);
  });

  it('should clear history', () => {
    const history = new ChangeHistory(5);
    history.push(makeOp('1'));
    history.clear();
    assert.strictEqual(history.length, 0);
    assert.strictEqual(history.canUndo(), false);
  });
});
