export class GestureState {
  constructor(){this.reset();}
  reset(){this.candidate='idle';this.since=0;this.last=0;this.fired=false;this.smooth=null;}
  update(gesture,confidence,now,threshold=.8){
    if(confidence<threshold)gesture='idle';
    if(now-this.last>500||gesture!==this.candidate){this.candidate=gesture;this.since=now;this.fired=false;}
    this.last=now;
    const delay=gesture==='clear'?1600:gesture==='select'||gesture==='confirm'?450:140;
    if(now-this.since<delay)return {gesture:'idle',event:false,progress:(now-this.since)/delay};
    const event=!this.fired;this.fired=true;return {gesture,event,progress:1};
  }
  point(p,alpha=.4){
    this.smooth=this.smooth?this.smooth.map((v,i)=>v+alpha*(p[i]-v)):p;
    return this.smooth;
  }
}
