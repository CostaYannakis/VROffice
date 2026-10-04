class Capture extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.out=[];this.position=0;this.enabled=false;this.port.onmessage=e=>{if(!e.data){this.send();this.port.postMessage('ended');}this.enabled=e.data;this.samples=[];this.out=[];this.position=0;};}
 send(){if(this.out.length){const data=new Int16Array(this.out).buffer;this.port.postMessage(data,[data]);this.out=[];}}
 process(inputs){const input=inputs[0]?.[0];if(!input||!this.enabled)return true;for(const x of input)this.samples.push(x);const ratio=sampleRate/16000;while(this.position+ratio<=this.samples.length){let sum=0,n=0;for(let i=Math.floor(this.position);i<Math.floor(this.position+ratio);i++){sum+=this.samples[i];n++;}this.out.push(Math.max(-32768,Math.min(32767,Math.round(sum/Math.max(n,1)*32767))));this.position+=ratio;if(this.out.length>=640)this.send();}const used=Math.floor(this.position);this.samples.splice(0,used);this.position-=used;return true;}
}registerProcessor('capture',Capture);
