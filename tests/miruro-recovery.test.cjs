const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../src/player.js'),'utf8');
const block=source.slice(source.indexOf('let miruroStall ='),source.indexOf('\nfunction renderQualityChoices()',source.indexOf('let miruroStall =')));
function setup(){let now=0,tick;const calls=[],video={paused:false,seeking:false,ended:false,currentTime:60,readyState:2};
  const context={episode:{provider:'miruro',number:1},videoServer:'bad',videoServers:[{label:'bad',kind:'soft'},{label:'good',kind:'soft'}],subtitleTitle:'Show'};
  const sandbox={currentPlaybackContext:context,Date:{now:()=>now},$:selector=>selector==='#video'?video:{value:'',textContent:'',classList:{contains:()=>true}},playbackDuration:()=>120,episodeTitle:()=> '1화',window:{lilac:{}},resolveIntoPlayer:async(...args)=>{calls.push(args)},setInterval:fn=>{tick=fn}};
  vm.createContext(sandbox);vm.runInContext(block,sandbox);
  return{context,video,calls,tick:async time=>{now=time;tick();await new Promise(resolve=>setImmediate(resolve))}};
}
test('15 seconds without playback progress switches server with position and failed-server exclusions',async()=>{
  const run=setup();await run.tick(0);await run.tick(14999);assert.equal(run.calls.length,0);await run.tick(15000);
  assert.equal(run.calls.length,1);assert.equal(run.calls[0][2].resumeProgress,50);assert.equal(run.calls[0][2].resumeSeconds,60);assert.deepEqual(Array.from(run.calls[0][2].miruroFailedServers),['bad']);
});
test('pause, seek, offline playback and progress reset stall detection',async()=>{
  for(const flag of ['paused','seeking','offline']){const run=setup();await run.tick(0);if(flag==='offline')run.context.offline=true;else run.video[flag]=true;await run.tick(20000);assert.equal(run.calls.length,0)}
  const run=setup();await run.tick(0);run.video.currentTime=61;await run.tick(10000);await run.tick(20000);assert.equal(run.calls.length,0);await run.tick(25000);assert.equal(run.calls.length,1);
});
test('recovery stops after two failures and never silently changes audio language',async()=>{
  const run=setup();run.context.miruroFailedServers=['one','two'];await run.tick(0);await run.tick(20000);assert.equal(run.calls.length,0);
  const audio=setup();audio.context.videoServers[1].kind='dub';await audio.tick(0);await audio.tick(20000);assert.equal(audio.calls.length,0);
});
test('automatic recovery resumes exact seconds even in the final five percent',()=>{
  const app=fs.readFileSync(path.resolve(__dirname,'../src/app.js'),'utf8');
  const at=app.indexOf('function applyPendingResume()'),end=app.indexOf('\n',at);
  const video={currentTime:0},context={pendingResumeSeconds:118,pendingResumeProgress:0,$:()=>video,playbackDuration:()=>120};
  vm.createContext(context);vm.runInContext(app.slice(at,end),context);
  assert.equal(context.applyPendingResume(),true);assert.equal(video.currentTime,118);assert.equal(context.pendingResumeSeconds,null);
});
