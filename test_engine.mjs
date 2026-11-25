import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './static/engine.mjs';
import {GestureState} from './static/gesture-state.mjs';

test('stroke creation, undo, redo and clear are reversible',()=>{
  const e=new DrawingEngine();e.start([.1,.2]);e.add([.4,.2]);e.commit();
  assert.equal(e.state.strokes.length,1);e.undo();assert.equal(e.state.strokes.length,0);
  e.redo();assert.equal(e.state.strokes.length,1);e.clear();assert.equal(e.state.strokes.length,0);
  e.undo();assert.equal(e.state.strokes.length,1);
});
test('eraser splits a crossing segment even when endpoints lie outside the radius',()=>{
  const e=new DrawingEngine();e.start([.1,.5]);e.add([.9,.5]);e.commit();
  e.erase([.5,.5],50);e.commit();assert.equal(e.state.strokes.length,2);
  assert.ok(e.state.strokes[0].points.at(-1)[0]<.5);
  assert.ok(e.state.strokes[1].points[0][0]>.5);
  e.undo();assert.equal(e.state.strokes.length,1);assert.equal(e.state.strokes[0].points.length,2);
});
test('eraser preserves distant ink and removes isolated dots',()=>{
  const e=new DrawingEngine();e.start([.1,.1]);e.commit();e.erase([.8,.8]);e.commit();assert.equal(e.state.strokes.length,1);
  e.erase([.1,.1]);e.commit();assert.equal(e.state.strokes.length,0);
});
test('new action discards redo and tool settings can be undone',()=>{
  const e=new DrawingEngine();e.change('color','#ff0000');e.undo();assert.equal(e.state.color,'#4667ee');
  e.change('width',10);assert.equal(e.future.length,0);e.undo();assert.equal(e.state.width,5);
});
test('clear needs continuous hold, fires once and resets on lost tracking',()=>{
  const s=new GestureState();let r;
  for(let t=0;t<1600;t+=100){r=s.update('clear',1,t);assert.equal(r.event,false);}
  r=s.update('clear',1,1600);assert.equal(r.gesture,'clear');assert.equal(r.event,true);
  assert.equal(s.update('clear',1,1700).event,false);
  assert.equal(s.update('clear',1,3000).gesture,'idle');
});
test('low confidence and changing pose stop drawing immediately',()=>{
  const s=new GestureState();s.update('draw',1,0);assert.equal(s.update('draw',1,200).gesture,'draw');
  assert.equal(s.update('draw',.2,250).gesture,'idle');
  assert.equal(s.update('erase',1,300).gesture,'idle');
});
