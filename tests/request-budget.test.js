import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { consumeBudget, initializeBudgets } from '../request-budget.js';
test('attempt limits are shared by connections and survive reopening the database', () => {
 const dir=mkdtempSync(join(tmpdir(),'budget-')); const file=join(dir,'data.db');
 let first=new DatabaseSync(file); initializeBudgets(first);
 const second=new DatabaseSync(file);
 try {
  assert.equal(consumeBudget(first,'open',2,1000).allowed,true);
  assert.equal(consumeBudget(second,'open',2,1001).allowed,true);
  first.close(); first=new DatabaseSync(file);
  assert.equal(consumeBudget(first,'open',2,1002).allowed,false);
  assert.equal(consumeBudget(second,'open',2,61000).allowed,true);
  assert.equal(consumeBudget(first,'create',2,1002).allowed,true);
 } finally { first.close(); second.close(); rmSync(dir,{recursive:true,force:true}); }
});
