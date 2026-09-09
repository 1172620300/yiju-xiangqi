const canvas = document.querySelector('#board');
const ctx = canvas.getContext('2d');
const badge = document.querySelector('#engineBadge');
const ribbon = document.querySelector('#turnRibbon');
const hint = document.querySelector('#boardHint');
const moveList = document.querySelector('#moveList');
const toast = document.querySelector('#toast');
const analysisState = document.querySelector('#analysisState');
const analysisToggle = document.querySelector('#analysisToggle');
const opponentMove = document.querySelector('#opponentMove');
const opponentEcho = document.querySelector('#opponentEcho');
const playerSideSelect = document.querySelector('#playerSide');
const recommendButton = document.querySelector('#recommendButton');
const homeScreen = document.querySelector('#homeScreen');
const gameScreen = document.querySelector('#gameScreen');
const modeTitle = document.querySelector('#modeTitle');
const modeNote = document.querySelector('#modeNote');
const sideChoice = document.querySelector('#sideChoice');
const authModal = document.querySelector('#authModal');
const authForm = document.querySelector('#authForm');
const authError = document.querySelector('#authError');
const accountButton = document.querySelector('#accountButton');
const userMenu = document.querySelector('#userMenu');
const roomModal = document.querySelector('#roomModal');
const roomError = document.querySelector('#roomError');
const roomCodeInput = document.querySelector('#roomCodeInput');
const historyButton = document.querySelector('#historyButton');
const historyCount = document.querySelector('#historyCount');
const reviewPanel = document.querySelector('#reviewPanel');
const recordList = document.querySelector('#recordList');
const reviewTotal = document.querySelector('#reviewTotal');
const reviewEmpty = document.querySelector('#reviewEmpty');
const reviewProgress = document.querySelector('#reviewProgress');
const reviewMoveLabel = document.querySelector('#reviewMoveLabel');
const reviewTrack = document.querySelector('#reviewTrack');

const START = [
  'rnbakabnr', '.........', '.c.....c.', 'p.p.p.p.p', '.........',
  '.........', 'P.P.P.P.P', '.C.....C.', '.........', 'RNBAKABNR'
].map(row => [...row]);

const NAMES = { K:'帅', A:'仕', B:'相', N:'马', R:'车', C:'炮', P:'兵', k:'将', a:'士', b:'象', n:'马', r:'车', c:'炮', p:'卒' };
const GLYPH_CROPS = {
  '兵':[34,42,93,100], '车':[141,43,81,96], '马':[237,44,88,96], '相':[337,42,91,99],
  '仕':[431,46,105,92], '帅':[536,42,95,100], '炮':[633,42,101,100], '象':[746,38,82,107],
  '士':[40,163,86,92], '将':[141,164,85,96], '卒':[242,160,83,104]
};
const glyphSheet = new Image();
const glyphCache = new Map();
let glyphReady = false;
let glyphUnavailable = false;
glyphSheet.decoding = 'async';
glyphSheet.src = 'piece-glyphs.png?v=1';
glyphSheet.addEventListener('load',()=>{glyphReady=true;glyphCache.clear();draw();});
const FILES = 'abcdefghi';
let board = cloneBoard(START);
let turn = 'red';
let selected = null;
let targets = [];
let history = [];
let records = [];
let thinking = false;
let botController = null;
let engine = 'fallback';
let analysisEnabled = true;
let analysisController = null;
let analysisTimer = null;
let lastOpponentMove = null;
let playerSide = 'red';
let boardFlipped = false;
let gameId = 0;
let recommendedMove = null;
let latestBestMove = null;
let recommendationRequested = false;
let positionKeys = [positionKey(board,'red')];
let gameMode = 'ai';
let currentUser = null;
let authMode = 'login';
let pendingHumanMode = false;
let activeRoom = null;
let roomMoveCount = 0;
let roomPollTimer = null;
let roomPollBusy = false;
let roomMoveBusy = false;
let roomPollController = null;
let gameMoves = [];
let currentRecordId = null;
let currentRecordStartedAt = null;
let currentRecordResult = '进行中';
let reviewRecords = [];
let reviewRecord = null;
let reviewStep = 0;
const GAME_RECORDS_KEY = 'yiju_xiangqi_records_v1';
const MAX_GAME_RECORDS = 30;
const invitedRoomCode = (new URLSearchParams(location.search).get('room')||'').toUpperCase();
let moveAnim = null;
let animRafId = null;

function cloneBoard(src) { return src.map(r => [...r]); }
function sideOf(p) { return p === '.' ? null : p === p.toUpperCase() ? 'red' : 'black'; }
function inBounds(r,c) { return r >= 0 && r < 10 && c >= 0 && c < 9; }
function palace(side,r,c) { return c>=3 && c<=5 && (side==='red' ? r>=7&&r<=9 : r>=0&&r<=2); }
function enemyAt(b,r,c,side) { return inBounds(r,c) && b[r][c]!=='.' && sideOf(b[r][c])!==side; }
function emptyAt(b,r,c) { return inBounds(r,c) && b[r][c]==='.'; }

function pseudoMoves(b,r,c) {
  const p=b[r][c], side=sideOf(p), type=p.toLowerCase(), out=[];
  const add=(rr,cc)=>{ if(inBounds(rr,cc) && (emptyAt(b,rr,cc)||enemyAt(b,rr,cc,side))) out.push({r:rr,c:cc}); };
  if(type==='k') {
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr,dc])=>{ if(palace(side,r+dr,c+dc)) add(r+dr,c+dc); });
    for(const dr of [-1,1]) { let rr=r+dr; while(inBounds(rr,c)&&b[rr][c]==='.') rr+=dr; if(inBounds(rr,c)&&b[rr][c].toLowerCase()==='k') add(rr,c); }
  } else if(type==='a') {
    [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(([dr,dc])=>{ if(palace(side,r+dr,c+dc)) add(r+dr,c+dc); });
  } else if(type==='b') {
    [[2,2],[2,-2],[-2,2],[-2,-2]].forEach(([dr,dc])=>{
      const rr=r+dr,cc=c+dc, crossed=side==='red'?rr<5:rr>4;
      if(!crossed && emptyAt(b,r+dr/2,c+dc/2)) add(rr,cc);
    });
  } else if(type==='n') {
    const steps=[[2,1,1,0],[2,-1,1,0],[-2,1,-1,0],[-2,-1,-1,0],[1,2,0,1],[-1,2,0,1],[1,-2,0,-1],[-1,-2,0,-1]];
    steps.forEach(([dr,dc,lr,lc])=>{ if(emptyAt(b,r+lr,c+lc)) add(r+dr,c+dc); });
  } else if(type==='r' || type==='c') {
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dr,dc])=>{
      let rr=r+dr,cc=c+dc,screen=false;
      while(inBounds(rr,cc)) {
        if(type==='r') { if(emptyAt(b,rr,cc)) out.push({r:rr,c:cc}); else { if(enemyAt(b,rr,cc,side)) out.push({r:rr,c:cc}); break; } }
        else if(!screen) { if(emptyAt(b,rr,cc)) out.push({r:rr,c:cc}); else screen=true; }
        else if(b[rr][cc]!=='.') { if(enemyAt(b,rr,cc,side)) out.push({r:rr,c:cc}); break; }
        rr+=dr;cc+=dc;
      }
    });
  } else if(type==='p') {
    const dr=side==='red'?-1:1; add(r+dr,c);
    const crossed=side==='red'?r<=4:r>=5;
    if(crossed) { add(r,c-1); add(r,c+1); }
  }
  return out;
}

function isInCheck(b,side) {
  let king=null;
  for(let r=0;r<10;r++) for(let c=0;c<9;c++) if(b[r][c].toLowerCase()==='k'&&sideOf(b[r][c])===side) king={r,c};
  if(!king) return true;
  const enemy=side==='red'?'black':'red';
  for(let r=0;r<10;r++) for(let c=0;c<9;c++) if(sideOf(b[r][c])===enemy)
    if(pseudoMoves(b,r,c).some(m=>m.r===king.r&&m.c===king.c)) return true;
  return false;
}

function legalFrom(b,r,c,respectRepetition=false) {
  const side=sideOf(b[r][c]);
  return pseudoMoves(b,r,c).filter(m=>{
    const test=cloneBoard(b); test[m.r][m.c]=test[r][c]; test[r][c]='.';
    return !isInCheck(test,side) && (!respectRepetition || !repetitionViolation(b,{r,c},m,side));
  });
}

function allLegal(b,side,respectRepetition=false) {
  const out=[];
  for(let r=0;r<10;r++) for(let c=0;c<9;c++) if(sideOf(b[r][c])===side)
    legalFrom(b,r,c,respectRepetition).forEach(to=>out.push({from:{r,c},to,captured:b[to.r][to.c],uci:coord(r,c)+coord(to.r,to.c)}));
  return out;
}

function coord(r,c) { return FILES[c] + (9-r); }
function fenOf(b,side) {
  const rows=b.map(row=>{ let s='',n=0; row.forEach(p=>{ if(p==='.') n++; else { if(n){s+=n;n=0;} s+=p; } }); return s+(n||''); });
  return rows.join('/')+' '+(side==='red'?'w':'b')+' - - 0 1';
}
function fromUci(move) { return { from:{c:FILES.indexOf(move[0]),r:9-Number(move[1])}, to:{c:FILES.indexOf(move[2]),r:9-Number(move[3])} }; }
function otherSide(side) { return side==='red'?'black':'red'; }
function blackAtBottom() { return (playerSide==='black')!==boardFlipped; }
function screenPos(pos) { return blackAtBottom()?{r:9-pos.r,c:8-pos.c}:pos; }
function boardPos(r,c) { return blackAtBottom()?{r:9-r,c:8-c}:{r,c}; }
function positionKey(b,side) { return b.map(row=>row.join('')).join('/')+' '+side; }
function repetitionViolation(b,from,to,side,keyHistory=positionKeys) {
  const test=cloneBoard(b);test[to.r][to.c]=test[from.r][from.c];test[from.r][from.c]='.';
  const key=positionKey(test,otherSide(side));
  return XiangqiRepetition.evaluate(key,isInCheck(test,otherSide(side)),keyHistory);
}

function makeMove(from,to,opts={}) {
  const piece=board[from.r][from.c], captured=board[to.r][to.c];
  history.push({board:cloneBoard(board),turn,records:[...records],gameMoves:[...gameMoves],currentRecordResult,positionKeys:[...positionKeys],lastOpponentMove:lastOpponentMove?{...lastOpponentMove,from:{...lastOpponentMove.from},to:{...lastOpponentMove.to}}:null});
  board[to.r][to.c]=piece; board[from.r][from.c]='.';
  if(opts.animate!==false) startMoveAnimation(from,to,piece,captured);
  const notation=`${NAMES[piece]} ${coord(from.r,from.c)}–${coord(to.r,to.c)}${captured!=='.'?' ×'+NAMES[captured]:''}`;
  records.push(notation);
  gameMoves.push(coord(from.r,from.c)+coord(to.r,to.c));
  if(sideOf(piece)!==playerSide) lastOpponentMove={from:{...from},to:{...to},notation};
  turn=turn==='red'?'black':'red'; selected=null;targets=[];
  positionKeys.push(positionKey(board,turn));
  saveCurrentGame();
  renderAll();
  const moves=allLegal(board,turn,true);
  if(!moves.length) finish(isInCheck(board,turn)?`${turn==='red'?'红':'黑'}方被将死`:'无子可走，和棋');
  return moves.length>0;
}

async function askBot() {
  const botSide=otherSide(playerSide);
  if(gameScreen.hidden||gameMode!=='ai'||controlsBothSides()||turn!==botSide||thinking) return;
  const requestGame=gameId;
  clearTimeout(analysisTimer);
  if(analysisController)analysisController.abort();
  thinking=true; ribbon.textContent=`${botSide==='red'?'红':'黑'}方思考中`; hint.textContent=engine==='pikafish'?'皮卡鱼正在计算…':'本地棋手正在思考…';
  const legal=allLegal(board,botSide,true);
  try {
    let data;
    for(let attempt=0;attempt<2;attempt++) {
      let moveTimer;
      try {
        const moveCtrl=new AbortController();botController=moveCtrl;moveTimer=setTimeout(()=>moveCtrl.abort(),18000);
        const res=await fetch('/api/move',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fen:fenOf(board,botSide),legalMoves:legal,depth:Number(document.querySelector('#depth').value)}),signal:moveCtrl.signal});
        data=await res.json(); if(!res.ok) throw new Error(data.error||'引擎错误');
        break;
      } catch(err) {
        if(attempt||requestGame!==gameId||err.name==='AbortError') throw err;
        hint.textContent='连接波动，正在重试…';
        await new Promise(resolve=>setTimeout(resolve,1000));
      } finally {
        clearTimeout(moveTimer);
      }
    }
    if(requestGame!==gameId) return;
    const parsed=fromUci(data.move);
    const valid=legal.some(m=>m.uci===data.move);
    if(!valid) throw new Error(`引擎返回了无效走法 ${data.move}`);
    makeMove(parsed.from,parsed.to);
  } catch(err) {
    if(requestGame===gameId&&legal.length) {
      const fallback=legal[Math.floor(Math.random()*legal.length)];
      showToast('服务器连接波动，本回合使用本地走法');
      makeMove(fallback.from,fallback.to);
    }
  }
  finally { if(requestGame===gameId){thinking=false;botController=null;} }
}

function finish(message) { thinking=false;currentRecordResult=message;saveCurrentGame(message);ribbon.textContent='对局结束';hint.textContent=message;showToast(message); }

function boardPadding(width) { return width*(window.innerWidth<=520?.055:.07); }

function onBoardClick(ev) {
  if(gameMode==='edit'){
    const rect=canvas.getBoundingClientRect(),pad=boardPadding(canvas.width),sx=(canvas.width-pad*2)/8,sy=(canvas.height-pad*2)/9;
    const r=Math.round(((ev.clientY-rect.top)*canvas.height/rect.height-pad)/sy),c=Math.round(((ev.clientX-rect.left)*canvas.width/rect.width-pad)/sx);
    if(inBounds(r,c)){const pos=boardPos(r,c);editSquare(pos.r,pos.c);}return;
  }
  if(gameMode==='review'||thinking || !canPlayTurn() || (gameMode==='online'&&activeRoom?.status!=='active')) return;
  const rect=canvas.getBoundingClientRect(), pad=boardPadding(canvas.width), sx=(canvas.width-pad*2)/8, sy=(canvas.height-pad*2)/9;
  const c=Math.round((ev.clientX-rect.left)*(canvas.width/rect.width)-pad)/sx;
  const r=Math.round((ev.clientY-rect.top)*(canvas.height/rect.height)-pad)/sy;
  const displayR=Math.round(r),displayC=Math.round(c); if(!inBounds(displayR,displayC)) return;
  const {r:rr,c:cc}=boardPos(displayR,displayC);
  if(selected && targets.some(m=>m.r===rr&&m.c===cc)) {
    if(gameMode==='online') submitRoomMove(selected,{r:rr,c:cc});
    else if(makeMove(selected,{r:rr,c:cc})) setTimeout(()=>afterMoveAnim(askBot),240);
    return;
  }
  if(selected) { const otherwiseLegal=legalFrom(board,selected.r,selected.c,false).some(m=>m.r===rr&&m.c===cc); const reason=otherwiseLegal&&repetitionViolation(board,selected,{r:rr,c:cc},turn); if(reason){showToast(reason);return;} }
  if(sideOf(board[rr][cc])===turn) { selected={r:rr,c:cc}; targets=legalFrom(board,rr,cc,true); draw(); }
  else { selected=null;targets=[];draw(); }
}

function resize() {
  const rect=canvas.getBoundingClientRect(), ratio=Math.min(window.devicePixelRatio||1,2);
  if(rect.width<2||rect.height<2) return false;
  canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);draw();
  return true;
}

function queueBoardResize(attempt=0) {
  requestAnimationFrame(()=>{
    if(!resize()&&attempt<4) queueBoardResize(attempt+1);
    else if(attempt===0) requestAnimationFrame(resize);
  });
}

function revealBoard() {
  void gameScreen.offsetWidth;
  resize();
  queueBoardResize();
  setTimeout(resize,120);
}

let audioCtx=null,audioMaster=null;
let soundEnabled=true;try{soundEnabled=localStorage.getItem('yiju_sound_enabled')!=='off';}catch{}
function ensureAudio(){
  try{
    if(!audioCtx){
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return null;
      audioCtx=new AC();
      audioMaster=audioCtx.createGain();
      audioMaster.gain.value=0.5;
      audioMaster.connect(audioCtx.destination);
    }
    if(audioCtx.state==='suspended') audioCtx.resume();
    return audioCtx;
  }catch{ return null; }
}
function unlockAudio(){ ensureAudio(); }
function woodHit(o){
  const ctx=ensureAudio();
  if(!ctx||!audioMaster) return;
  const t0=ctx.currentTime,dur=o.dur||0.09,freq=o.freq||1600,gain=o.gain||0.5;
  const n=Math.max(1,Math.floor(ctx.sampleRate*dur));
  const buf=ctx.createBuffer(1,n,ctx.sampleRate),data=buf.getChannelData(0);
  for(let i=0;i<n;i++) data[i]=(Math.random()*2-1)*(1-i/n);
  const noise=ctx.createBufferSource();noise.buffer=buf;
  const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.value=freq;bp.Q.value=1.1;
  const g=ctx.createGain();g.gain.setValueAtTime(0.0001,t0);g.gain.exponentialRampToValueAtTime(gain,t0+0.004);g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
  noise.connect(bp);bp.connect(g);g.connect(audioMaster);noise.start(t0);noise.stop(t0+dur);
  const osc=ctx.createOscillator();osc.type='sine';osc.frequency.setValueAtTime(freq*0.45,t0);osc.frequency.exponentialRampToValueAtTime(Math.max(40,freq*0.22),t0+dur*0.7);
  const og=ctx.createGain();og.gain.setValueAtTime(0.0001,t0);og.gain.exponentialRampToValueAtTime(gain*0.55,t0+0.006);og.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
  osc.connect(og);og.connect(audioMaster);osc.start(t0);osc.stop(t0+dur);
}
function playMoveSound(captured){
  if(!soundEnabled) return;
  if(captured&&captured!=='.') woodHit({freq:720,dur:0.12,gain:0.6});
  else woodHit({freq:1750,dur:0.07,gain:0.45});
}
if(document.addEventListener) document.addEventListener('pointerdown',function once(){unlockAudio();},{once:true});

function clamp01(v,a,b){return v<a?a:(v>b?b:v);}
function easeInOutCubic(t){return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function countBetween(from,to){
  let n=0;
  if(from.r===to.r){const lo=Math.min(from.c,to.c),hi=Math.max(from.c,to.c);for(let c=lo+1;c<hi;c++)if(board[from.r][c]!=='.')n++;}
  else if(from.c===to.c){const lo=Math.min(from.r,to.r),hi=Math.max(from.r,to.r);for(let r=lo+1;r<hi;r++)if(board[r][from.c]!=='.')n++;}
  return n;
}
function animKindOf(piece,from,to){
  const t=piece.toLowerCase();
  if(t==='p')return'hop';
  if(t==='c')return countBetween(from,to)>0?'cannon':'slide';
  return'slide';
}
function startMoveAnimation(from,to,piece,captured){
  playMoveSound(captured);
  moveAnim=null;
  if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const f=screenPos(from),t2=screenPos(to);
  moveAnim={toR:to.r,toC:to.c,piece,captured:captured||'.',fDisp:{x:f.c,y:f.r},tDisp:{x:t2.c,y:t2.r},kind:animKindOf(piece,from,to),t0:performance.now(),dur:430,landStart:0,trail:[]};
  if(!animRafId) animRafId=requestAnimationFrame(animTick);
}
function animTick(now){
  const a=moveAnim;
  if(!a){animRafId=null;return;}
  const t=Math.max(0,Math.min(1,(now-a.t0)/a.dur));
  if(t>=1&&!a.landStart)a.landStart=now;
  draw();
  const landT=a.landStart?Math.max(0,Math.min(1,(now-a.landStart)/260)):0;
  if(t<1||landT<1){animRafId=requestAnimationFrame(animTick);}
  else{moveAnim=null;animRafId=null;draw();}
}
function afterMoveAnim(fn){
  let fired=false;
  const fire=()=>{ if(!fired){fired=true;fn();} };
  const deadline=setTimeout(fire,2200);
  const check=()=>{ if(moveAnim){ requestAnimationFrame(check); } else { clearTimeout(deadline); fire(); } };
  check();
}
function drawMovingPiece(sx,sy,pad,compact){
  const a=moveAnim,now=performance.now(),t=Math.max(0,Math.min(1,(now-a.t0)/a.dur)),e=easeInOutCubic(t);
  const rad=Math.min(sx,sy)*(compact?.435:.39),fx=pad+a.fDisp.x*sx,fy=pad+a.fDisp.y*sy,tx=pad+a.tDisp.x*sx,ty=pad+a.tDisp.y*sy;
  let x=fx+(tx-fx)*e,y=fy+(ty-fy)*e,rot=0;
  if(a.kind==='jump'){y-=rad*3.1*4*t*(1-t);rot=Math.sin(Math.PI*t)*.18;}
  else if(a.kind==='hop'){y-=rad*1.35*4*t*(1-t);rot=Math.sin(Math.PI*t)*.12;}
  else if(a.kind==='cannon'){y-=rad*1.65*Math.sin(Math.PI*clamp01((t-.18)/.42,0,1));}
  if(a.captured!=='.'){const capAlpha=Math.max(0,1-t*1.25);if(capAlpha>0)drawPiece(tx,ty,a.captured,rad,false,compact,0,capAlpha*.9);}
  if(t>0.03)a.trail.push({x,y,t:now});
  a.trail=a.trail.filter(pt=>now-pt.t<130);
  for(let i=0;i<a.trail.length;i++){const pt=a.trail[i],alpha=.32*(1-(now-pt.t)/130);ctx.beginPath();ctx.arc(pt.x,pt.y,rad*.16,0,Math.PI*2);ctx.fillStyle=`rgba(190,120,40,${alpha.toFixed(3)})`;ctx.fill();}
  drawPiece(x,y,a.piece,rad,false,compact,rot);
  if(a.landStart){const lt=Math.max(0,Math.min(1,(now-a.landStart)/260));ctx.beginPath();ctx.arc(tx,ty,rad*(.7+1.35*lt),0,Math.PI*2);ctx.lineWidth=Math.max(1.5,rad*.14);ctx.strokeStyle=`rgba(150,84,28,${(.55*(1-lt)).toFixed(3)})`;ctx.stroke();}
}

function draw() {
  const w=canvas.width,h=canvas.height,pad=boardPadding(w),sx=(w-pad*2)/8,sy=(h-pad*2)/9,compact=window.innerWidth<=520;
  ctx.clearRect(0,0,w,h);
  const woodX=compact?0:pad*.42,woodY=compact?0:pad*.35;
  const wood=ctx.createLinearGradient(0,0,0,h);wood.addColorStop(0,compact?'#efc77f':'#e9c27d');wood.addColorStop(.5,compact?'#f2cf8d':'#ebc682');wood.addColorStop(1,compact?'#e6b96f':'#dfb16b');ctx.fillStyle=wood;ctx.fillRect(woodX,woodY,w-woodX*2,h-woodY*2);
  if(compact){
    ctx.save();ctx.beginPath();ctx.rect(woodX,woodY,w-woodX*2,h-woodY*2);ctx.clip();
    const glow=ctx.createRadialGradient(w*.5,h*.48,0,w*.5,h*.48,w*.69);glow.addColorStop(0,'rgba(255,255,231,.82)');glow.addColorStop(.34,'rgba(255,242,196,.45)');glow.addColorStop(.72,'rgba(246,205,137,.12)');glow.addColorStop(1,'rgba(137,81,35,.055)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);ctx.restore();
    ctx.strokeStyle='rgba(105,69,39,.34)';ctx.lineWidth=Math.max(2,w*.006);ctx.strokeRect(w*.008,h*.007,w*.984,h*.986);
    ctx.strokeStyle='rgba(255,244,202,.56)';ctx.lineWidth=Math.max(1,w*.002);ctx.strokeRect(w*.015,h*.013,w*.97,h*.974);
  }else{const grain=ctx.createLinearGradient(0,0,w,h);grain.addColorStop(0,'rgba(255,245,195,.2)');grain.addColorStop(.48,'rgba(117,60,20,.04)');grain.addColorStop(1,'rgba(97,44,15,.14)');ctx.fillStyle=grain;ctx.fillRect(woodX,woodY,w-woodX*2,h-woodY*2);}
  ctx.strokeStyle=compact?'rgba(105,70,43,.66)':'#5e3a29';ctx.lineWidth=Math.max(1,w*(compact?.0027:.002));
  for(let r=0;r<10;r++){ctx.beginPath();ctx.moveTo(pad,pad+r*sy);ctx.lineTo(w-pad,pad+r*sy);ctx.stroke();}
  for(let c=0;c<9;c++){ctx.beginPath();ctx.moveTo(pad+c*sx,pad);ctx.lineTo(pad+c*sx,pad+4*sy);ctx.moveTo(pad+c*sx,pad+5*sy);ctx.lineTo(pad+c*sx,pad+9*sy);ctx.stroke();}
  ctx.strokeRect(pad,pad,sx*8,sy*9);
  [[0,3,2,5],[0,5,2,3],[7,3,9,5],[7,5,9,3]].forEach(([r1,c1,r2,c2])=>{ctx.beginPath();ctx.moveTo(pad+c1*sx,pad+r1*sy);ctx.lineTo(pad+c2*sx,pad+r2*sy);ctx.stroke();});
  ctx.fillStyle=compact?'rgba(126,79,39,.47)':'rgba(89,52,34,.78)';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${sy*(compact?.36:.32)}px "YouYuan", "Yuanti SC", STYuanti, KaiTi, serif`;if(compact){ctx.shadowColor='rgba(255,241,197,.72)';ctx.shadowOffsetY=Math.max(1,w*.003);ctx.shadowBlur=0;}ctx.fillText(blackAtBottom()?'汉 界':'楚 河',pad+sx*2,pad+sy*4.5);ctx.fillText(blackAtBottom()?'楚 河':'汉 界',pad+sx*6,pad+sy*4.5);ctx.shadowColor='transparent';
  targets.forEach(m=>{const d=screenPos(m);ctx.beginPath();ctx.arc(pad+d.c*sx,pad+d.r*sy,Math.max(4,w*.008),0,Math.PI*2);ctx.fillStyle=board[m.r][m.c]==='.'?'rgba(142,38,32,.7)':'rgba(142,38,32,.18)';ctx.fill();if(board[m.r][m.c]!=='.'){ctx.strokeStyle='#a62c27';ctx.lineWidth=w*.004;ctx.beginPath();ctx.arc(pad+d.c*sx,pad+d.r*sy,Math.min(sx,sy)*.38,0,Math.PI*2);ctx.stroke();}});
  if(lastOpponentMove) {
    const a=screenPos(lastOpponentMove.from),b=screenPos(lastOpponentMove.to),ax=pad+a.c*sx,ay=pad+a.r*sy,bx=pad+b.c*sx,by=pad+b.r*sy;
    ctx.save();ctx.strokeStyle='rgba(34,67,58,.52)';ctx.lineWidth=Math.max(1,w*.002);ctx.setLineDash([w*.009,w*.008]);ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='rgba(34,67,58,.62)';ctx.beginPath();ctx.arc(ax,ay,Math.max(4,w*.007),0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(34,67,58,.82)';ctx.lineWidth=Math.max(2,w*.004);ctx.beginPath();ctx.arc(bx,by,Math.min(sx,sy)*.45,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  if(recommendedMove && canPlayTurn()) {
    const a=screenPos(recommendedMove.from),b=screenPos(recommendedMove.to),ax=pad+a.c*sx,ay=pad+a.r*sy,bx=pad+b.c*sx,by=pad+b.r*sy;
    const angle=Math.atan2(by-ay,bx-ax),pieceRadius=Math.min(sx,sy)*.48;
    const startX=ax+Math.cos(angle)*pieceRadius,startY=ay+Math.sin(angle)*pieceRadius,endX=bx-Math.cos(angle)*pieceRadius,endY=by-Math.sin(angle)*pieceRadius;
    ctx.save();ctx.strokeStyle='#c88726';ctx.fillStyle='#c88726';ctx.lineWidth=Math.max(3,w*.005);ctx.shadowColor='rgba(232,171,67,.58)';ctx.shadowBlur=w*.012;
    ctx.beginPath();ctx.moveTo(startX,startY);ctx.lineTo(endX,endY);ctx.stroke();
    const head=Math.max(9,w*.014);ctx.beginPath();ctx.moveTo(endX,endY);ctx.lineTo(endX-Math.cos(angle-.55)*head,endY-Math.sin(angle-.55)*head);ctx.lineTo(endX-Math.cos(angle+.55)*head,endY-Math.sin(angle+.55)*head);ctx.closePath();ctx.fill();
    ctx.shadowBlur=0;ctx.lineWidth=Math.max(2,w*.004);ctx.beginPath();ctx.arc(bx,by,Math.min(sx,sy)*.47,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
  for(let r=0;r<10;r++) for(let c=0;c<9;c++) if(board[r][c]!=='.') {
    if(moveAnim&&r===moveAnim.toR&&c===moveAnim.toC) continue;
    const d=screenPos({r,c});drawPiece(pad+d.c*sx,pad+d.r*sy,board[r][c],Math.min(sx,sy)*(compact?.435:.39),selected?.r===r&&selected?.c===c,compact);
  }
  if(moveAnim) drawMovingPiece(sx,sy,pad,compact);
}

function drawPiece(x,y,p,rad,active,compact=false,rot=0,alpha=1) {
  ctx.save();ctx.globalAlpha=alpha;if(rot){ctx.translate(x,y);ctx.rotate(rot);x=0;y=0;}const red=sideOf(p)==='red',ink=red?'#b42620':'#31463f';
  ctx.shadowColor=compact?'rgba(77,43,20,.34)':'rgba(42,20,7,.32)';ctx.shadowBlur=rad*(compact?.32:.24);ctx.shadowOffsetY=rad*(compact?.2:.16);
  const wall=ctx.createLinearGradient(x,y-rad,x,y+rad*1.18);wall.addColorStop(0,'#e0ad58');wall.addColorStop(.68,'#bd7737');wall.addColorStop(1,'#8d512b');ctx.beginPath();ctx.arc(x,y+rad*.1,rad*1.025,0,Math.PI*2);ctx.fillStyle=wall;ctx.fill();ctx.lineWidth=Math.max(1.5,rad*.065);ctx.strokeStyle='#7a4b2d';ctx.stroke();
  ctx.shadowColor='transparent';
  const rim=ctx.createRadialGradient(x-rad*.4,y-rad*.46,rad*.04,x+rad*.1,y+rad*.16,rad*1.12);rim.addColorStop(0,'#fff2b7');rim.addColorStop(.3,'#ebbd67');rim.addColorStop(.72,'#ce9145');rim.addColorStop(1,'#9c5d30');ctx.beginPath();ctx.arc(x,y,rad,0,Math.PI*2);ctx.fillStyle=rim;ctx.fill();ctx.lineWidth=Math.max(1.7,rad*.072);ctx.strokeStyle=active?'#fff7c8':'#87572f';ctx.stroke();
  const face=ctx.createRadialGradient(x-rad*.28,y-rad*.34,rad*.03,x+rad*.08,y+rad*.12,rad*.9);face.addColorStop(0,'#fffbdc');face.addColorStop(.48,'#f7dda1');face.addColorStop(1,'#e2ad5d');ctx.beginPath();ctx.arc(x,y,rad*.8,0,Math.PI*2);ctx.fillStyle=face;ctx.fill();ctx.lineWidth=Math.max(1.25,rad*.052);ctx.strokeStyle=ink;ctx.stroke();
  ctx.beginPath();ctx.arc(x,y,rad*.92,3.55,5.62);ctx.lineWidth=Math.max(1,rad*.045);ctx.strokeStyle='rgba(255,252,218,.88)';ctx.stroke();ctx.beginPath();ctx.arc(x,y+rad*.025,rad*.93,.18,2.86);ctx.lineWidth=Math.max(1,rad*.04);ctx.strokeStyle='rgba(103,57,28,.32)';ctx.stroke();
  ctx.shadowColor=red?'rgba(100,27,18,.18)':'rgba(19,51,43,.2)';ctx.shadowBlur=rad*.04;ctx.shadowOffsetY=rad*.035;
  if(!drawBrushGlyph(NAMES[p],ink,x,y+rad*.035,rad)) {ctx.fillStyle=ink;ctx.font=`800 ${rad*(compact?1.04:1.08)}px "YouYuan", "Yuanti SC", STYuanti, "Microsoft YaHei UI", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(NAMES[p],x,y+rad*.035);}
  ctx.restore();
}

function drawBrushGlyph(character,ink,x,y,rad) {
  if(glyphUnavailable||!glyphReady||!GLYPH_CROPS[character]) return false;
  try {
    const key=`${character}-${ink}`;
    let glyph=glyphCache.get(key);
    if(!glyph) {
      const [sx,sy,sw,sh]=GLYPH_CROPS[character],size=128,padding=5;
      glyph=document.createElement('canvas');glyph.width=size;glyph.height=size;
      const glyphCtx=glyph.getContext('2d',{willReadFrequently:true});
      if(!glyphCtx) throw new Error('glyph canvas unavailable');
      const scale=Math.min((size-padding*2)/sw,(size-padding*2)/sh),dw=sw*scale,dh=sh*scale;
      glyphCtx.drawImage(glyphSheet,sx,sy,sw,sh,(size-dw)/2,(size-dh)/2,dw,dh);
      const pixels=glyphCtx.getImageData(0,0,size,size),rgb=ink.match(/[\da-f]{2}/gi).map(value=>parseInt(value,16));
      for(let i=0;i<pixels.data.length;i+=4){const sourceAlpha=pixels.data[i+3]/255,darkness=255-(pixels.data[i]+pixels.data[i+1]+pixels.data[i+2])/3;pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2];pixels.data[i+3]=Math.max(0,Math.min(255,(darkness-5)*1.45*sourceAlpha));}
      glyphCtx.putImageData(pixels,0,0);glyphCache.set(key,glyph);
    }
    const side=rad*1.62;ctx.drawImage(glyph,x-side/2,y-side/2,side,side);return true;
  } catch {
    glyphUnavailable=true;glyphCache.clear();
    return false;
  }
}

function renderAll() {
  ribbon.textContent=gameMode==='online'&&activeRoom?.status==='waiting'?'等待好友加入':turn==='red'?'红方行棋':'黑方行棋';
  ribbon.classList.toggle('black-turn',turn==='black');
  if(gameMode==='online') hint.textContent=activeRoom?.status==='waiting'?'等待好友输入房间码加入…':turn===playerSide?'轮到你行棋。':'等待对方落子…';
  else hint.textContent=controlsBothSides()?`轮到${turn==='red'?'红':'黑'}方 · 双方均由你落子。`:turn===playerSide?'点击棋子，再点击落点。':'等待对手落子…';
  document.querySelector('#customActions').hidden=gameMode!=='ai'||!customStart;
  document.querySelector('#controlOpponent').setAttribute('aria-pressed',String(controlsBothSides()));
  document.querySelector('#controlOpponent').textContent=controlsBothSides()?'对方由我控制':'控制对方';
  moveList.innerHTML=records.length?'': '<li class="empty">落子后将在这里记录</li>';
  records.forEach((m,i)=>{const li=document.createElement('li');li.textContent=m;li.value=i+1;moveList.appendChild(li);});
  opponentMove.textContent=lastOpponentMove?.notation||'等待对手落子';
  opponentEcho.classList.toggle('has-move',Boolean(lastOpponentMove));
  moveList.scrollTop=moveList.scrollHeight; draw();
  scheduleAnalysis();
}

function reset() {
  moveAnim=null;animRafId=null;
  gameId++;board=cloneBoard(customStart?.board||START);turn=customStart?.turn||'red';selected=null;targets=[];history=[];records=[];positionKeys=[positionKey(board,turn)];
  lastOpponentMove=null;recommendedMove=null;latestBestMove=null;recommendationRequested=false;thinking=false;startGameRecord();renderAll();
  if(gameMode==='ai'&&!canPlayTurn())setTimeout(askBot,320);
}

function updateSeats() {
  if(gameMode==='online') {
    const opponentSide=otherSide(playerSide), humanRed=playerSide==='red', opponentRed=opponentSide==='red';
    const opponentName=opponentSide==='red'?activeRoom?.red:activeRoom?.black;
    document.querySelector('#opponentName').textContent=opponentName||'等待好友加入';
    document.querySelector('#humanSeat').textContent=currentUser?.username||'我方';
    document.querySelector('.black-player small').textContent='对手';
    document.querySelector('#humanSeat').previousElementSibling.textContent='本机';
    document.querySelector('#opponentSideTag').textContent=opponentRed?'红':'黑';
    document.querySelector('#humanSideTag').textContent=humanRed?'红':'黑';
    document.querySelector('#opponentAvatar').textContent=opponentRed?'红':'黑';
    document.querySelector('#humanAvatar').textContent=humanRed?'红':'黑';
    document.querySelector('#opponentAvatar').classList.toggle('red-avatar',opponentRed);
    document.querySelector('#humanAvatar').classList.toggle('red-avatar',humanRed);
    document.querySelector('#opponentSideTag').classList.toggle('red-tag',opponentRed);
    document.querySelector('#humanSideTag').classList.toggle('red-tag',humanRed);
    sideChoice.hidden=true;
    return;
  }
  sideChoice.hidden=false;
  document.querySelector('.black-player small').textContent='对手';
  document.querySelector('#humanSeat').previousElementSibling.textContent='本机';
  document.querySelector('#opponentAvatar').textContent='魚';
  document.querySelector('#humanAvatar').textContent='你';
  document.querySelector('#opponentName').textContent=engine==='pikafish'?'Pikafish':'本地棋手';
  const opponentSide=otherSide(playerSide), humanRed=playerSide==='red', opponentRed=opponentSide==='red';
  document.querySelector('#humanSeat').textContent=`执${humanRed?'红':'黑'}`;
  document.querySelector('#humanSideTag').textContent=humanRed?'红':'黑';
  document.querySelector('#opponentSideTag').textContent=opponentRed?'红':'黑';
  document.querySelector('#humanAvatar').classList.toggle('red-avatar',humanRed);
  document.querySelector('#humanSideTag').classList.toggle('red-tag',humanRed);
  document.querySelector('#opponentAvatar').classList.toggle('red-avatar',opponentRed);
  document.querySelector('#opponentSideTag').classList.toggle('red-tag',opponentRed);
}
function showToast(text) { toast.textContent=text;toast.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toast.classList.remove('show'),1800); }

function loadGameRecords() {
  try {
    const value=JSON.parse(localStorage.getItem(GAME_RECORDS_KEY)||'[]');
    return Array.isArray(value)?value.filter(item=>item&&Array.isArray(item.moves)).slice(0,MAX_GAME_RECORDS):[];
  } catch { return []; }
}

function writeGameRecords(value) {
  try { localStorage.setItem(GAME_RECORDS_KEY,JSON.stringify(value.slice(0,MAX_GAME_RECORDS))); }
  catch { showToast('浏览器未允许保存对局记录'); }
  refreshHistoryCount();
}

function refreshHistoryCount() {
  historyCount.textContent=String(loadGameRecords().length);
}

function startGameRecord() {
  initialBoard=cloneBoard(gameMode==='online'?START:board);initialTurn=gameMode==='online'?'red':turn;
  gameMoves=[];
  currentRecordId=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  currentRecordStartedAt=new Date().toISOString();
  currentRecordResult='进行中';
}

function currentOpponent() {
  if(gameMode==='online') {
    const side=otherSide(playerSide);
    return (side==='red'?activeRoom?.red:activeRoom?.black)||'好友玩家';
  }
  return engine==='pikafish'?'Pikafish':'本地棋手';
}

function removeCurrentGameRecord() {
  if(!currentRecordId) return;
  writeGameRecords(loadGameRecords().filter(item=>item.id!==currentRecordId));
}

function saveCurrentGame(result=currentRecordResult) {
  if(!['ai','online'].includes(gameMode)||!currentRecordId) return;
  if(!gameMoves.length) { removeCurrentGameRecord();return; }
  currentRecordResult=result;
  const saved=loadGameRecords();
  const item={
    id:currentRecordId,mode:gameMode,startedAt:currentRecordStartedAt,updatedAt:new Date().toISOString(),
    initialBoard:cloneBoard(initialBoard),initialTurn,playerSide,opponent:currentOpponent(),result:currentRecordResult,moves:[...gameMoves],notations:[...records]
  };
  const existing=saved.findIndex(record=>record.id===currentRecordId);
  if(existing>=0) saved.splice(existing,1);
  saved.unshift(item);writeGameRecords(saved);
}

function recordDate(value) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'未知时间':date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
}

function renderReviewList() {
  recordList.replaceChildren();
  reviewTotal.textContent=`本机 · ${reviewRecords.length} 局`;
  reviewEmpty.hidden=reviewRecords.length>0;
  reviewProgress.hidden=!reviewRecord;
  reviewRecords.forEach(item=>{
    const button=document.createElement('button');button.type='button';button.className='record-item';button.dataset.recordId=item.id;
    const title=document.createElement('strong');title.textContent=`${item.mode==='online'?'真人对战':'人机对战'} · ${item.opponent||'对手'}`;
    const time=document.createElement('time');time.dateTime=item.updatedAt||item.startedAt;time.textContent=recordDate(item.updatedAt||item.startedAt);
    const result=document.createElement('span');result.textContent=item.result||'进行中';
    const count=document.createElement('b');count.textContent=`${item.moves.length}步`;
    button.append(title,time,result,count);button.classList.toggle('active',item.id===reviewRecord?.id);
    button.addEventListener('click',()=>selectReviewRecord(item.id));recordList.appendChild(button);
  });
}

function renderReviewPosition() {
  if(!reviewRecord) {
    setAnalysisStatus('选择对局后分析');
    board=cloneBoard(START);playerSide='red';turn='red';lastOpponentMove=null;selected=null;targets=[];recommendedMove=null;
    ribbon.textContent='等待选择对局';hint.textContent='完成第一步落子后，对局会自动保存在这里。';modeNote.textContent='暂无记录';draw();revealBoard();return;
  }
  const start=recordStart(reviewRecord);board=start.board;playerSide=reviewRecord.playerSide||'red';lastOpponentMove=null;
  for(let index=0;index<reviewStep;index++) {
    const move=reviewRecord.moves[index],parsed=fromUci(move),piece=board[parsed.from.r]?.[parsed.from.c];
    if(!piece||piece==='.'||!inBounds(parsed.to.r,parsed.to.c)) break;
    const captured=board[parsed.to.r][parsed.to.c];board[parsed.to.r][parsed.to.c]=piece;board[parsed.from.r][parsed.from.c]='.';
    lastOpponentMove={from:parsed.from,to:parsed.to,notation:reviewRecord.notations?.[index]||`${NAMES[piece]} ${move.slice(0,2)}–${move.slice(2,4)}${captured!=='.'?' ×'+NAMES[captured]:''}`};
  }
  turn=reviewStep%2?otherSide(start.turn):start.turn;selected=null;targets=[];recommendedMove=null;
  ribbon.textContent=reviewStep===0?'开局':`第 ${reviewStep} 步`;
  ribbon.classList.toggle('black-turn',turn==='black');
  const notation=reviewStep?reviewRecord.notations?.[reviewStep-1]||reviewRecord.moves[reviewStep-1]:'初始局面';
  hint.textContent=`${reviewStep} / ${reviewRecord.moves.length} · ${notation}`;
  modeNote.textContent=`${reviewRecord.result||'进行中'} · ${reviewRecord.moves.length}步`;
  reviewMoveLabel.textContent=reviewStep===0?'开局':`${reviewStep} / ${reviewRecord.moves.length}　${notation}`;
  reviewTrack.style.width=`${reviewRecord.moves.length?reviewStep/reviewRecord.moves.length*100:0}%`;
  document.querySelector('#reviewStart').disabled=reviewStep===0;
  document.querySelector('#reviewPrev').disabled=reviewStep===0;
  document.querySelector('#reviewNext').disabled=reviewStep>=reviewRecord.moves.length;
  document.querySelector('#reviewEnd').disabled=reviewStep>=reviewRecord.moves.length;
  draw();revealBoard();reviewAnalysis();
}

function selectReviewRecord(id) {
  reviewRecord=reviewRecords.find(item=>item.id===id)||null;
  reviewStep=0;
  renderReviewList();renderReviewPosition();
}

function openHistory() {
  editorPanel.hidden=true;gameScreen.classList.remove('edit-mode');
  gameId++;thinking=false;stopRoomPolling();activeRoom=null;
  if(analysisController) analysisController.abort();clearTimeout(analysisTimer);
  gameMode='review';document.body.classList.add('game-active');gameScreen.classList.remove('human-mode');gameScreen.classList.add('review-mode');
  modeTitle.textContent='对局复盘';modeNote.disabled=true;homeScreen.hidden=true;gameScreen.hidden=false;reviewPanel.hidden=false;document.querySelector('#analysisTitle').textContent='复盘分析';
  reviewRecords=loadGameRecords();reviewRecord=reviewRecords[0]||null;reviewStep=0;
  renderReviewList();renderReviewPosition();
}

function enterGame(mode) {
  if(mode==='human'&&!currentUser) {
    pendingHumanMode=true;
    openAuth('登录后才能进入真人对战。');
    return;
  }
  if(mode==='human') { openRoomLobby(invitedRoomCode); return; }
  stopRoomPolling();activeRoom=null;
  customStart=null;controlOpponent=false;
  gameMode=mode;
  document.body.classList.add('game-active');
  playerSide='red';playerSideSelect.value='red';
  gameScreen.classList.remove('human-mode','review-mode');reviewPanel.hidden=true;
  modeTitle.textContent='人机对战';document.querySelector('#analysisTitle').textContent='实时胜率';
  modeNote.textContent='对手 · Pikafish';modeNote.disabled=true;
  document.querySelector('#newGame').textContent='重新开局';
  homeScreen.hidden=true;gameScreen.hidden=false;
  updateSeats();reset();
  revealBoard();
}

function returnHome() {
  gameId++;thinking=false;
  stopRoomPolling();activeRoom=null;
  if(analysisController) analysisController.abort();
  clearTimeout(analysisTimer);
  editorPanel.hidden=true;editorSnapshot=null;gameScreen.classList.remove('edit-mode');
  gameScreen.hidden=true;homeScreen.hidden=false;
  document.body.classList.remove('game-active');gameScreen.classList.remove('review-mode');reviewPanel.hidden=true;refreshHistoryCount();
  if(new URLSearchParams(location.search).has('room')) window.history.replaceState(null,'',location.pathname);
}

function renderAccount() {
  accountButton.hidden=Boolean(currentUser);
  userMenu.hidden=!currentUser;
  document.querySelector('#accountName').textContent=currentUser?.username||'';
}

function setAuthMode(mode) {
  authMode=mode;
  const registering=mode==='register';
  document.querySelector('#authTitle').textContent=registering?'注册棋手':'登录棋室';
  document.querySelector('#authSubmit').textContent=registering?'注册并登录':'登录';
  document.querySelector('#authPassword').autocomplete=registering?'new-password':'current-password';
  document.querySelector('#loginTab').classList.toggle('active',!registering);
  document.querySelector('#registerTab').classList.toggle('active',registering);
  document.querySelector('#loginTab').setAttribute('aria-selected',String(!registering));
  document.querySelector('#registerTab').setAttribute('aria-selected',String(registering));
  authError.textContent='';
}

function openAuth(message='登录后可进入真人对战。') {
  document.querySelector('#authLead').textContent=message;
  setAuthMode('login');
  authModal.hidden=false;
  requestAnimationFrame(()=>document.querySelector('#authUsername').focus());
}

function closeAuth() {
  authModal.hidden=true;
  authError.textContent='';
  authForm.reset();
  pendingHumanMode=false;
}

async function loadAccount() {
  try {
    const response=await fetch('/api/auth/me');
    if(response.ok) currentUser=(await response.json()).user;
  } catch {}
  renderAccount();
  if(invitedRoomCode) {
    if(currentUser) openRoomLobby(invitedRoomCode);
    else { pendingHumanMode=true;openAuth('登录后输入房间码加入好友对局。'); }
  }
}

function openRoomLobby(prefill='') {
  roomError.textContent='';
  roomCodeInput.value=/^[A-Z2-9]{6}$/.test(prefill)?prefill:'';
  roomModal.hidden=false;
  if(roomCodeInput.value) requestAnimationFrame(()=>roomCodeInput.focus());
}

function closeRoomLobby() {
  roomModal.hidden=true;roomError.textContent='';
}

function stopRoomPolling() {
  clearTimeout(roomPollTimer);roomPollTimer=null;
  roomPollController?.abort();roomPollController=null;roomPollBusy=false;
}

function enterOnlineRoom(room) {
  stopRoomPolling();
  gameMode='online';activeRoom=room;roomMoveCount=0;
  document.body.classList.add('game-active');
  playerSide=room.seat;playerSideSelect.value=playerSide;
  gameScreen.classList.add('human-mode');gameScreen.classList.remove('review-mode');reviewPanel.hidden=true;
  modeTitle.textContent='真人对战';
  modeNote.textContent=`房间 ${room.code} · 复制邀请`;modeNote.disabled=false;
  window.history.replaceState(null,'',`${location.pathname}?room=${room.code}`);
  document.querySelector('#newGame').textContent='退出房间';
  closeRoomLobby();homeScreen.hidden=true;gameScreen.hidden=false;
  reset();applyRoomState(room,true);revealBoard();pollRoom();
}

function applyRoomState(room,force=false) {
  if(gameMode!=='online'||!room||room.code!==activeRoom?.code) return;
  const previous=activeRoom;
  const rebuild=force||room.moves.length<roomMoveCount;
  activeRoom=room;playerSide=room.seat;
  if(rebuild) {
    board=cloneBoard(START);turn='red';selected=null;targets=[];history=[];records=[];gameMoves=[];
    positionKeys=[positionKey(board,'red')];lastOpponentMove=null;roomMoveCount=0;
  }
  while(roomMoveCount<room.moves.length) {
    const parsed=fromUci(room.moves[roomMoveCount]);
    const piece=board[parsed.from.r]?.[parsed.from.c];
    const legal=piece&&piece!=='.'&&sideOf(piece)===turn&&legalFrom(board,parsed.from.r,parsed.from.c,true).some(m=>m.r===parsed.to.r&&m.c===parsed.to.c);
    if(!legal) { showToast('房间棋谱同步失败');break; }
    roomMoveCount++;makeMove(parsed.from,parsed.to,{animate:!rebuild&&roomMoveCount===room.moves.length});
  }
  const changed=force||previous?.status!==room.status||previous?.red!==room.red||previous?.black!==room.black||previous?.turn!==room.turn;
  if(changed) { updateSeats();renderAll(); }
}

async function pollRoom() {
  clearTimeout(roomPollTimer);
  if(gameMode!=='online'||!activeRoom||roomPollBusy||roomMoveBusy) return;
  roomPollBusy=true;
  const controller=new AbortController();roomPollController=controller;
  let failed=false;
  try {
    const query=new URLSearchParams({version:String(roomMoveCount),status:activeRoom.status,wait:'1'});
    const response=await fetch(`/api/rooms/${activeRoom.code}?${query}`,{cache:'no-store',signal:controller.signal});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'房间同步失败');
    applyRoomState(data.room);
    renderAll();
  } catch(err) {
    failed=err.name!=='AbortError';
    if(failed&&gameMode==='online') hint.textContent='连接中断，正在重试…';
  }
  finally {
    if(roomPollController===controller) roomPollController=null;
    roomPollBusy=false;
    if(gameMode==='online'&&!roomMoveBusy) roomPollTimer=setTimeout(pollRoom,failed?800:30);
  }
}

async function submitRoomMove(from,to) {
  if(!activeRoom||roomMoveBusy) return;
  clearTimeout(roomPollTimer);roomPollController?.abort();roomMoveBusy=true;thinking=true;selected=null;targets=[];draw();
  const move=coord(from.r,from.c)+coord(to.r,to.c);
  try {
    const response=await fetch(`/api/rooms/${activeRoom.code}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({move,version:roomMoveCount})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'落子失败');
    applyRoomState(data.room);
  } catch(err) { showToast(err instanceof TypeError?'连接服务器失败，请检查网络后重试':err.message); }
  finally { roomMoveBusy=false;thinking=false;renderAll();if(gameMode==='online')roomPollTimer=setTimeout(pollRoom,30); }
}

async function copyRoomInvite() {
  if(gameMode!=='online'||!activeRoom) return;
  const invite=`${location.origin}/?room=${activeRoom.code}`;
  try { await navigator.clipboard.writeText(invite);showToast('邀请链接已复制'); }
  catch { showToast(`房间码：${activeRoom.code}`); }
}

function formatMove(move) {
  if(!move || move.length < 4) return '—';
  const from=fromUci(move).from, to=fromUci(move).to, piece=board[from.r]?.[from.c];
  return piece && piece!=='.' ? `${NAMES[piece]} ${move.slice(0,2)}→${move.slice(2,4)}` : `${move.slice(0,2)}→${move.slice(2,4)}`;
}

function showRecommendation(move) {
  if(!recommendationRequested || !move || move.length<4 || (gameMode==='ai'&&!canPlayTurn())) return;
  const parsed=fromUci(move),piece=board[parsed.from.r]?.[parsed.from.c];
  if(!piece || piece==='.' || sideOf(piece)!==turn) return;
  recommendedMove=parsed;
  document.querySelector('#bestMove').textContent=formatMove(move);
  draw();
}

function setAnalysisStatus(text, fresh=false) {
  analysisState.textContent=text;
  document.querySelector('#analysisRetry').hidden=!analysisEnabled || !/异常|失败|中断|超时|忙碌|未收到/.test(text);
  document.querySelector('.board-evaluation').dataset.stale=String(!fresh);
  if(!fresh) {
    document.querySelector('#redRate').textContent='—';
    document.querySelector('#blackRate').textContent='—';
    document.querySelector('#drawRate').textContent='和棋 —';
    document.querySelector('#analysisDepth').textContent='—';
  }
}

function setAnalysis(data) {
  if(data.red == null) return;
  document.querySelector('#redRate').textContent=`${data.red.toFixed(1)}%`;
  document.querySelector('#blackRate').textContent=`${data.black.toFixed(1)}%`;
  document.querySelector('#drawRate').textContent=`和棋 ${data.draw.toFixed(1)}%`;
  document.querySelector('#redBar').style.width=`${data.red}%`;
  document.querySelector('#drawBar').style.width=`${data.draw}%`;
  document.querySelector('#blackBar').style.width=`${data.black}%`;
  document.querySelector('#analysisDepth').textContent=data.depth;
  if(data.bestMove){latestBestMove=data.bestMove;showRecommendation(data.bestMove);}
  setAnalysisStatus('计算中 · 当前为估算',true);
}

function scheduleAnalysis() {
  clearTimeout(analysisTimer);
  if(analysisController) analysisController.abort();
  if(gameScreen.hidden || gameMode!=='ai') return;
  recommendedMove=null;latestBestMove=null;recommendationRequested=false;recommendButton.textContent='查看推荐';recommendButton.setAttribute('aria-pressed','false');document.querySelector('#bestMove').textContent='点击按钮获取';draw();
  if(!analysisEnabled){setAnalysisStatus('已暂停 · 可在设置中继续');return;}
  if(gameMode==='ai'&&!canPlayTurn()){setAnalysisStatus('等待对手落子');return;}
  if(engine!=='pikafish'){setAnalysisStatus('分析未连接 · 可刷新重试');return;}
  setAnalysisStatus('等待计算');
  const allowedMoves=allLegal(board,turn,true).map(move=>move.uci);
  if(!allowedMoves.length){setAnalysisStatus('对局结束');return;}
  analysisTimer=setTimeout(runAnalysis,180);
}

function runAnalysis() { return runPositionAnalysis(false); }

async function runPositionAnalysis(review, retryAttempt=0) {
  if(gameScreen.hidden || !analysisEnabled || (review ? gameMode!=='review' || !reviewRecord : gameMode!=='ai' || !canPlayTurn())) return;
  clearTimeout(analysisTimer);
  if(analysisController)analysisController.abort();
  const requestGame=gameId, requestFen=fenOf(board,turn);
  const controller=new AbortController();
  analysisController=controller;
  setAnalysisStatus('计算中');
  let received=false, completed=false;
  const timeout=setTimeout(()=>controller.abort('timeout'),45000);
  const consume=line=>{
    if(!line.trim() || controller.signal.aborted || analysisController!==controller) return;
    const data=JSON.parse(line);
    if(data.interrupted) throw Object.assign(new Error('落子优先 · 等待自动分析'),{retryable:true});
    if(data.error) throw new Error('分析失败 · 请重新分析');
    if(data.done) {
      completed=true;
      if(!received) throw new Error('未收到胜率 · 可重新分析');
      setAnalysisStatus(data.limited?'分析完成 · 限时估算':'分析完成',true);
      if(data.bestMove){latestBestMove=data.bestMove;if(!review)showRecommendation(data.bestMove);}
    } else if(data.red!=null) {
      received=true;
      if(review)setReviewAnalysis(data);else setAnalysis(data);
    }
  };
  try {
    const allowedMoves=allLegal(board,turn,true).map(move=>move.uci);
    const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fen:fenOf(board,turn),depth:16,allowedMoves}),signal:controller.signal});
    if(!response.ok) throw Object.assign(new Error(response.status===503?'引擎忙碌 · 稍后重新分析':'分析连接异常 · 请稍后重试'),{retryable:response.status===503});
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    while(true) {
      const {value,done}=await reader.read();
      if(controller.signal.aborted || analysisController!==controller) return;
      buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
      const lines=buffer.split('\n');buffer=lines.pop();
      for(const line of lines)consume(line);
      if(completed){await reader.cancel();return;}
      if(done){consume(buffer);break;}
    }
    if(!completed)throw new Error('分析中断 · 请重新分析');
  } catch(err) {
    if(analysisController!==controller) return;
    if(controller.signal.aborted){if(controller.signal.reason==='timeout')setAnalysisStatus('计算超时 · 请重新分析');}
    else if(err.retryable && retryAttempt<3) {
      setAnalysisStatus('等待引擎空闲 · 将自动分析');
      analysisTimer=setTimeout(()=>{
        if(analysisController===controller && requestGame===gameId && requestFen===fenOf(board,turn))runPositionAnalysis(review,retryAttempt+1);
      },1500 * 2 ** retryAttempt);
    } else setAnalysisStatus(err instanceof TypeError?'连接异常 · 请检查网络':err.message);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

function reviewAnalysis() {
  clearTimeout(analysisTimer);
  if(analysisController) analysisController.abort();
  if(gameScreen.hidden || gameMode!=='review' || !reviewRecord) return;
  if(!analysisEnabled){setAnalysisStatus('已暂停 · 可在设置中继续');return;}
  if(engine!=='pikafish'){setAnalysisStatus('分析未连接 · 可刷新重试');return;}
  setAnalysisStatus('等待计算');
  const allowedMoves=allLegal(board,turn,true).map(move=>move.uci);
  if(!allowedMoves.length){setAnalysisStatus('对局结束');return;}
  analysisTimer=setTimeout(runReviewAnalysis,180);
}
function runReviewAnalysis() { return runPositionAnalysis(true); }
function setReviewAnalysis(data) {
  if(data.red==null) return;
  document.querySelector('#redRate').textContent=`${data.red.toFixed(1)}%`;
  document.querySelector('#blackRate').textContent=`${data.black.toFixed(1)}%`;
  document.querySelector('#drawRate').textContent=`和棋 ${data.draw.toFixed(1)}%`;
  document.querySelector('#redBar').style.width=`${data.red}%`;
  document.querySelector('#drawBar').style.width=`${data.draw}%`;
  document.querySelector('#blackBar').style.width=`${data.black}%`;
  document.querySelector('#analysisDepth').textContent=data.depth;
  if(data.bestMove) document.querySelector('#bestMove').textContent=formatMove(data.bestMove);
  setAnalysisStatus('计算中 · 当前为估算',true);
}

const editorPanel=document.querySelector('#editorPanel');
const editorError=document.querySelector('#editorError');
let editorSnapshot=null, editorTool='move', editorUndo=[];
let controlOpponent=false;
let customStart=null, initialBoard=cloneBoard(START), initialTurn='red';

function controlsBothSides() { return gameMode==='ai'&&Boolean(customStart)&&controlOpponent; }
function canPlayTurn() { return turn===playerSide||controlsBothSides(); }
function toggleOpponentControl() {
  if(gameMode!=='ai'||!customStart)return;
  controlOpponent=!controlOpponent;
  gameId++;if(botController)botController.abort();botController=null;thinking=false;
  selected=null;targets=[];recommendedMove=null;
  renderAll();
  if(!controlOpponent&&turn!==playerSide)setTimeout(askBot,280);
  showToast(controlOpponent?'已接管对方，双方均可手动落子':'已交回皮卡鱼控制');
}

function setEditorTool(tool) {
  editorTool=tool;selected=null;targets=[];
  document.querySelectorAll('[data-editor-tool]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.editorTool===tool)));
  hint.textContent=tool==='move'?'点选棋子，再点目标位置。':tool==='erase'?'点击棋子即可移除。':`已选${sideOf(tool)==='red'?'红':'黑'}${NAMES[tool]}，点击棋盘放置。`;
  draw();
}
function rememberEditorBoard() {
  editorUndo.push(cloneBoard(board));if(editorUndo.length>50)editorUndo.shift();
  document.querySelector('#editorUndo').disabled=false;
  editorError.textContent='';
}
function editSquare(r,c) {
  if(editorTool==='move') {
    if(!selected){if(board[r][c]!=='.'){selected={r,c};draw();}return;}
    if(selected.r===r&&selected.c===c){selected=null;draw();return;}
    rememberEditorBoard();board[r][c]=board[selected.r][selected.c];board[selected.r][selected.c]='.';selected=null;
  } else {
    const piece=editorTool==='erase'?'.':editorTool;
    if(board[r][c]===piece)return;
    rememberEditorBoard();board[r][c]=piece;
  }
  draw();
}
function openBoardEditor() {
  const fromHome=gameScreen.hidden;
  if(!fromHome && gameMode!=='ai')return;
  closeSettings();
  editorSnapshot={fromHome,board:cloneBoard(board),turn,playerSide,lastOpponentMove};
  gameId++;if(botController)botController.abort();botController=null;thinking=false;clearTimeout(analysisTimer);if(analysisController)analysisController.abort();
  moveAnim=null;if(animRafId)cancelAnimationFrame(animRafId);animRafId=null;
  board=cloneBoard(fromHome?START:board);turn=fromHome?'red':turn;playerSide='red';
  gameMode='edit';selected=null;targets=[];recommendedMove=null;lastOpponentMove=null;editorUndo=[];
  homeScreen.hidden=true;gameScreen.hidden=false;reviewPanel.hidden=true;editorPanel.hidden=false;
  gameScreen.classList.remove('human-mode','review-mode');gameScreen.classList.add('edit-mode');document.body.classList.add('game-active');
  modeTitle.textContent='自定义棋盘';modeNote.textContent='摆好后开始人机对战';ribbon.textContent='摆棋模式';ribbon.classList.remove('black-turn');
  document.querySelector('#editorTurn').value=turn;
  document.querySelector('#editorSide').value=fromHome?'red':editorSnapshot.playerSide;
  document.querySelector('#editorUndo').disabled=true;editorError.textContent='';setEditorTool('move');revealBoard();
}
function cancelBoardEditor() {
  const saved=editorSnapshot;if(!saved)return;
  board=cloneBoard(saved.board);turn=saved.turn;playerSide=saved.playerSide;lastOpponentMove=saved.lastOpponentMove;
  selected=null;targets=[];gameMode='ai';editorSnapshot=null;editorPanel.hidden=true;gameScreen.classList.remove('edit-mode');
  modeTitle.textContent=customStart?'自定义对局':'人机对战';modeNote.textContent='对手 · Pikafish';
  if(saved.fromHome){returnHome();return;}
  renderAll();if(turn!==playerSide)setTimeout(askBot,280);
}
function validateCustomPosition(b,side) {
  const limits={k:1,a:2,b:2,n:2,r:2,c:2,p:5},counts={};
  for(let r=0;r<10;r++)for(let c=0;c<9;c++){
    const piece=b[r][c];if(piece==='.')continue;
    counts[piece]=(counts[piece]||0)+1;
    const type=piece.toLowerCase(),red=sideOf(piece)==='red',rr=red?r:9-r,label=`${red?'红':'黑'}${NAMES[piece]}`;
    if(counts[piece]>limits[type])return `${label}数量过多，最多${limits[type]}枚。`;
    if(type==='k'&&!palace(sideOf(piece),r,c))return `${label}需要放在九宫内。`;
    if(type==='a'&&!['9,3','9,5','8,4','7,3','7,5'].includes(`${rr},${c}`))return `${label}需要放在九宫斜线上。`;
    if(type==='b'&&!['9,2','9,6','7,0','7,4','7,8','5,2','5,6'].includes(`${rr},${c}`))return `${label}需要放在本方象位，不能过河。`;
    if(type==='p'&&(rr>6 || (rr>=5&&c%2!==0)))return `${label}位置不合法：不能后退，过河前需在原兵线上。`;
  }
  if(counts.K!==1||counts.k!==1)return '请分别放置一枚红帅和黑将。';
  const redKing=b.flat().indexOf('K'),blackKing=b.flat().indexOf('k');
  if(redKing%9===blackKing%9){const c=redKing%9;let blocked=false;for(let r=Math.floor(blackKing/9)+1;r<Math.floor(redKing/9);r++)if(b[r][c]!=='.')blocked=true;if(!blocked)return '将帅不能直接照面，请移位或在中间放置棋子。';}
  if(isInCheck(b,otherSide(side)))return '后行方正被将军，请调整棋子或更换先行方。';
  if(!allLegal(b,side,false).length)return '先行方已无合法走法，请调整局面后再开始。';
  return '';
}
function startCustomGame() {
  const first=document.querySelector('#editorTurn').value,error=validateCustomPosition(board,first);
  if(error){editorError.textContent=error;return;}
  if(editorSnapshot?.fromHome)controlOpponent=false;
  customStart={board:cloneBoard(board),turn:first};playerSide=document.querySelector('#editorSide').value;playerSideSelect.value=playerSide;
  gameMode='ai';editorSnapshot=null;editorPanel.hidden=true;gameScreen.classList.remove('edit-mode');
  modeTitle.textContent='自定义对局';modeNote.textContent='对手 · Pikafish';document.querySelector('#newGame').textContent='重开此局';
  updateSeats();reset();window.scrollTo({top:0,behavior:'smooth'});
}
function recordStart(record) {
  const valid=Array.isArray(record.initialBoard)&&record.initialBoard.length===10&&record.initialBoard.every(row=>Array.isArray(row)&&row.length===9&&row.every(p=>typeof p==='string'&&/^[rnbakcpRNBAKCP.]$/.test(p)));
  return {board:cloneBoard(valid?record.initialBoard:START),turn:valid&&record.initialTurn==='black'?'black':'red'};
}
for(const side of ['red','black']) {
  const palette=document.querySelector(`#${side}Palette`);
  for(const type of 'KABNRCP') {
    const piece=side==='red'?type:type.toLowerCase(),button=document.createElement('button');
    button.type='button';button.dataset.editorTool=piece;button.textContent=NAMES[piece];button.setAttribute('aria-label',`${side==='red'?'红':'黑'}${NAMES[piece]}`);button.setAttribute('aria-pressed','false');
    palette.appendChild(button);
  }
}
document.querySelectorAll('[data-editor-tool]').forEach(button=>button.addEventListener('click',()=>setEditorTool(button.dataset.editorTool)));
document.querySelector('#customModeButton').addEventListener('click',openBoardEditor);
document.querySelector('#editPositionButton').addEventListener('click',openBoardEditor);
document.querySelector('#editCurrentBoard').addEventListener('click',openBoardEditor);
document.querySelector('#controlOpponent').addEventListener('click',toggleOpponentControl);
document.querySelector('#editorCancel').addEventListener('click',cancelBoardEditor);
document.querySelector('#editorStart').addEventListener('click',startCustomGame);
document.querySelector('#editorClear').addEventListener('click',()=>{rememberEditorBoard();board=START.map(()=>Array(9).fill('.'));selected=null;draw();});
document.querySelector('#editorReset').addEventListener('click',()=>{rememberEditorBoard();board=cloneBoard(START);selected=null;draw();});
document.querySelector('#editorUndo').addEventListener('click',()=>{if(!editorUndo.length)return;board=editorUndo.pop();selected=null;editorError.textContent='';document.querySelector('#editorUndo').disabled=!editorUndo.length;draw();});
canvas.addEventListener('keydown',event=>{
  if(gameMode!=='edit'||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(event.key))return;
  event.preventDefault();
  let r=Number(canvas.dataset.editR||'9'),c=Number(canvas.dataset.editC||'4');
  if(event.key==='Enter'||event.key===' '){const pos=boardPos(r,c);editSquare(pos.r,pos.c);}
  else{r=Math.max(0,Math.min(9,r+(event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0)));c=Math.max(0,Math.min(8,c+(event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0)));}
  canvas.dataset.editR=r;canvas.dataset.editC=c;hint.textContent=`键盘位置 ${coord(boardPos(r,c).r,boardPos(r,c).c)} · 方向键移动，回车放置或选中。`;
});

document.querySelector('#flipBoard').addEventListener('click',()=>{
  boardFlipped=!boardFlipped;
  moveAnim=null;if(animRafId)cancelAnimationFrame(animRafId);animRafId=null;
  document.querySelector('#flipBoard').setAttribute('aria-pressed',String(boardFlipped));
  draw();showToast(`已切换为${blackAtBottom()?'黑':'红'}方在下`);
});
canvas.addEventListener('click',onBoardClick);
window.addEventListener('resize',queueBoardResize);
historyButton.addEventListener('click',openHistory);
document.querySelector('#reviewStart').addEventListener('click',()=>{if(reviewRecord){reviewStep=0;renderReviewPosition();}});
document.querySelector('#reviewPrev').addEventListener('click',()=>{if(reviewRecord&&reviewStep>0){reviewStep--;renderReviewPosition();}});
document.querySelector('#reviewNext').addEventListener('click',()=>{if(reviewRecord&&reviewStep<reviewRecord.moves.length){reviewStep++;renderReviewPosition();}});
document.querySelector('#reviewEnd').addEventListener('click',()=>{if(reviewRecord){reviewStep=reviewRecord.moves.length;renderReviewPosition();}});
document.querySelector('#aiModeButton').addEventListener('click',()=>enterGame('ai'));
document.querySelector('#humanModeButton').addEventListener('click',()=>enterGame('human'));
const settingsButton=document.querySelector('#settingsButton');
const settingsPanel=document.querySelector('#settingsPanel');
const settingsClose=document.querySelector('#settingsClose');
const soundToggle=document.querySelector('#soundToggle');
function closeSettings(){settingsPanel.hidden=true;settingsButton.setAttribute('aria-expanded','false');}
soundToggle.checked=!!soundEnabled;
soundToggle.addEventListener('change',()=>{
  soundEnabled=soundToggle.checked;
  try{localStorage.setItem('yiju_sound_enabled',soundEnabled?'on':'off');}catch{}
  if(soundEnabled) playMoveSound();
});
settingsButton.addEventListener('click',()=>{
  const open=settingsPanel.hidden;
  settingsPanel.hidden=!open;
  settingsButton.setAttribute('aria-expanded',String(!open));
});
settingsClose.addEventListener('click',closeSettings);
document.addEventListener('click',(e)=>{ if(e.target===settingsPanel) closeSettings(); });
document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&!settingsPanel.hidden) closeSettings(); });
document.querySelector('#backHome').addEventListener('click',()=>{settingsPanel.hidden=true;returnHome();});
modeNote.addEventListener('click',copyRoomInvite);
accountButton.addEventListener('click',()=>{pendingHumanMode=false;openAuth();});
document.querySelector('#authClose').addEventListener('click',closeAuth);
document.querySelector('#loginTab').addEventListener('click',()=>setAuthMode('login'));
document.querySelector('#registerTab').addEventListener('click',()=>setAuthMode('register'));
document.querySelector('#authSkip').addEventListener('click',()=>{const shouldEnterAi=pendingHumanMode;closeAuth();if(shouldEnterAi)enterGame('ai');});
document.querySelector('#roomClose').addEventListener('click',closeRoomLobby);
document.querySelector('#createRoomButton').addEventListener('click',async()=>{
  const button=document.querySelector('#createRoomButton');button.disabled=true;roomError.textContent='';
  try {
    const response=await fetch('/api/rooms/create',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'创建房间失败');
    enterOnlineRoom(data.room);
  } catch(err) { roomError.textContent=err instanceof TypeError?'连接服务器失败，请检查网络后重试':err.message; }
  finally { button.disabled=false; }
});
document.querySelector('#joinRoomForm').addEventListener('submit',async ev=>{
  ev.preventDefault();const button=document.querySelector('#joinRoomButton');button.disabled=true;roomError.textContent='';
  try {
    const code=roomCodeInput.value.trim().toUpperCase();
    const response=await fetch('/api/rooms/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'加入房间失败');
    enterOnlineRoom(data.room);
  } catch(err) { roomError.textContent=err instanceof TypeError?'连接服务器失败，请检查网络后重试':err.message; }
  finally { button.disabled=false; }
});
document.querySelector('#logoutButton').addEventListener('click',async()=>{
  try { await fetch('/api/auth/logout',{method:'POST'}); } catch {}
  currentUser=null;renderAccount();showToast('已退出登录');
});
authForm.addEventListener('submit',async ev=>{
  ev.preventDefault();authError.textContent='';
  const submit=document.querySelector('#authSubmit');submit.disabled=true;
  try {
    const response=await fetch(`/api/auth/${authMode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.querySelector('#authUsername').value,password:document.querySelector('#authPassword').value})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'操作失败');
    currentUser=data.user;renderAccount();
    const enterHuman=pendingHumanMode;closeAuth();showToast(authMode==='register'?'注册成功':'登录成功');
    if(enterHuman) enterGame('human');
  } catch(err) { authError.textContent=err instanceof TypeError?'连接服务器失败，请检查网络后重试':err.message; }
  finally { submit.disabled=false; }
});
document.querySelector('#newGame').addEventListener('click',()=>{if(gameMode==='online'){returnHome();showToast('已退出房间');}else{reset();showToast('已重新开局');}});
document.querySelector('#undo').addEventListener('click',()=>{
  if(gameMode==='online') return showToast('在线对局不能悔棋');
  if(thinking) return showToast('请等待对手落子');
  if(!history.length) return showToast('还没有可以撤回的走法');
  let state=history.pop(); if(gameMode==='ai'&&!controlsBothSides()&&state.turn!==playerSide&&history.length) state=history.pop();
  board=cloneBoard(state.board);turn=state.turn;records=[...state.records];gameMoves=[...(state.gameMoves||[])];currentRecordResult=state.currentRecordResult||'进行中';positionKeys=[...(state.positionKeys||[positionKey(board,turn)])];lastOpponentMove=state.lastOpponentMove||null;selected=null;targets=[];saveCurrentGame();renderAll();showToast('已悔棋');
  if(gameMode==='ai'&&!canPlayTurn()) setTimeout(askBot,280);
});
document.querySelector('#copyFen').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(fenOf(board,turn));showToast('局面 FEN 已复制');}catch{showToast(fenOf(board,turn));}});
document.querySelector('#analysisRetry').addEventListener('click',()=>{
  clearTimeout(analysisTimer);
  if(analysisController)analysisController.abort();
  if(gameMode==='review' && reviewRecord)runReviewAnalysis();
  else if(gameMode==='ai')runAnalysis();
});
analysisToggle.addEventListener('click',()=>{
  analysisEnabled=!analysisEnabled; analysisToggle.textContent=analysisEnabled?'暂停':'继续'; analysisToggle.setAttribute('aria-pressed',String(analysisEnabled));
  if(analysisEnabled){showToast('实时分析已开启');if(gameMode==='review')reviewAnalysis();else scheduleAnalysis();} else {clearTimeout(analysisTimer);if(analysisController)analysisController.abort();setAnalysisStatus('已暂停 · 可在设置中继续');showToast('实时分析已暂停');}
});
recommendButton.addEventListener('click',()=>{
  recommendationRequested=!recommendationRequested;recommendButton.textContent=recommendationRequested?'隐藏推荐':'查看推荐';recommendButton.setAttribute('aria-pressed',String(recommendationRequested));
  if(recommendationRequested){document.querySelector('#bestMove').textContent=latestBestMove?'正在显示':'计算中';if(latestBestMove)showRecommendation(latestBestMove);}else{recommendedMove=null;document.querySelector('#bestMove').textContent='点击按钮获取';draw();}
});
playerSideSelect.addEventListener('change',()=>{
  playerSide=playerSideSelect.value;updateSeats();reset();showToast(`已交换为${playerSide==='red'?'红':'黑'}方`);
});

fetch('/api/status?cached=1').then(r=>r.json()).then(data=>{
  engine=data.engine;badge.classList.add('ready');
  badge.querySelector('span').textContent=engine==='pikafish'?(data.healthy===null?'Pikafish 已就绪':'Pikafish 已连接'):'轻量对手已就绪';
  if(gameMode==='ai') document.querySelector('#opponentName').textContent=engine==='pikafish'?'Pikafish':'本地棋手';
  if(engine==='pikafish' && !gameScreen.hidden){if(gameMode==='review')reviewAnalysis();else scheduleAnalysis();}
  else if(engine!=='pikafish')setAnalysisStatus('分析未连接 · 可刷新重试');
}).catch(()=>badge.querySelector('span').textContent='引擎连接失败');

loadAccount();
refreshHistoryCount();
queueBoardResize();
