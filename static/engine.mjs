export class DrawingEngine {
  constructor() {
    this.state = {strokes: [], color: '#4667ee', width: 5};
    this.past = []; this.future = []; this.before = null; this.active = null;
  }
  begin() { if (!this.before) this.before = structuredClone(this.state); }
  commit() {
    if (this.before && JSON.stringify(this.before) !== JSON.stringify(this.state)) {
      this.past.push(this.before); if (this.past.length > 60) this.past.shift(); this.future = [];
    }
    this.before = null; this.active = null;
  }
  start(point) {
    this.commit(); this.begin();
    this.active = {color:this.state.color, width:this.state.width, points:[point]};
    this.state.strokes.push(this.active);
  }
  add(point) {
    if (!this.active) return;
    const p = this.active.points.at(-1);
    if (Math.hypot(point[0]-p[0], point[1]-p[1]) > .0005) this.active.points.push(point);
    if (this.active.points.length >= 9000) {this.commit(); this.start(point);}
  }
  change(key, value) {this.commit(); this.begin(); this.state[key]=value; this.commit();}
  clear() {this.commit(); this.begin(); this.state.strokes=[]; this.commit();}
  undo() {this.commit(); if(this.past.length){this.future.push(structuredClone(this.state)); this.state=this.past.pop();}}
  redo() {this.commit(); if(this.future.length){this.past.push(structuredClone(this.state)); this.state=this.future.pop();}}
  erase(point, radius=22) {
    this.begin();
    const center=[point[0]*1600,point[1]*1000];
    this.state.strokes=this.state.strokes.flatMap(s=>splitStroke(s,center,radius+s.width/2));
  }
  paint(canvas) {
    const ctx=canvas.getContext('2d'), w=canvas.width,h=canvas.height;
    ctx.clearRect(0,0,w,h);ctx.lineCap='round';ctx.lineJoin='round';
    for(const s of this.state.strokes){
      ctx.strokeStyle=s.color;ctx.fillStyle=s.color;ctx.lineWidth=s.width*w/1600;
      ctx.beginPath(); s.points.forEach((p,i)=>i?ctx.lineTo(p[0]*w,p[1]*h):ctx.moveTo(p[0]*w,p[1]*h));ctx.stroke();
      if(s.points.length===1){const p=s.points[0];ctx.beginPath();ctx.arc(p[0]*w,p[1]*h,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
    }
  }
}

export function splitStroke(stroke, center, radius) {
  const points=stroke.points.map(p=>[p[0]*1600,p[1]*1000]);
  const outside=p=>Math.hypot(p[0]-center[0],p[1]-center[1])>radius;
  if(points.length===1) return outside(points[0])?[stroke]:[];
  const pieces=[];let current=[];
  const flush=()=>{if(current.length)pieces.push({...stroke,points:current.map(p=>[p[0]/1600,p[1]/1000])});current=[];};
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1];
    const ox=a[0]-center[0],oy=a[1]-center[1],A=dx*dx+dy*dy;
    if(A<1e-12)continue;
    const B=2*(ox*dx+oy*dy),C=ox*ox+oy*oy-radius*radius,D=B*B-4*A*C;
    const ts=[0,1];if(D>0)for(const t of [(-B-Math.sqrt(D))/(2*A),(-B+Math.sqrt(D))/(2*A)])if(t>0&&t<1)ts.push(t);
    ts.sort((x,y)=>x-y);
    const at=t=>[a[0]+dx*t,a[1]+dy*t];
    for(let j=1;j<ts.length;j++){
      if(outside(at((ts[j-1]+ts[j])/2))){if(!current.length)current.push(at(ts[j-1]));current.push(at(ts[j]));}
      else flush();
    }
  }
  flush();return pieces;
}
