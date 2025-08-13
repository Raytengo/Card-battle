import { CARDS } from './config/cards.js';
import { deck as DECK_TEMPLATE } from './config/deck.js'; // 把配置當模板使用
import { GAME_CONFIG } from './config/game.js';
import { MAP_CONFIG } from './config/map.js';
import { BUILDINGS, BUILDING_POSITIONS } from './config/buildings.js';

window.addEventListener('DOMContentLoaded', () => {

  // ===== DOM =====
  const gameContainer = document.getElementById('game-container');
  const entitiesContainer = document.getElementById('entities-container');
  const handContainer = document.getElementById('hand-container');
  const elixirBar = document.getElementById('elixir-bar');
  const elixirText = document.getElementById('elixir-text');
  const messageBox = document.getElementById('message-box');
  const dragPreview = document.getElementById('drag-preview');

  // ===== State =====
  let entities = {};
  let elixir = { player: GAME_CONFIG.initialElixir, enemy: GAME_CONFIG.initialElixir };
  let hand = { player: [], enemy: [] };
  let currentDeck = createFreshDeck(); // 每局各自的可變牌庫
  let gameLoopInterval, elixirInterval, aiInterval;
  let isGameOver = false;
  let nextEntityId = 0;
  const FRAME_TIME = GAME_CONFIG.frameTime;
  let activeCardToDeploy = null;
  let listenersBound = false;

  // ===== Geometry helpers =====
  const pxPerTile = () => gameContainer.offsetHeight / 50;
  const speedPx = (unit) => (unit.speed / 60) * (gameContainer.offsetHeight / 600);

  const RIVER_Y = () => gameContainer.offsetHeight * MAP_CONFIG.riverY;
  const RIVER_H = () => gameContainer.offsetHeight * MAP_CONFIG.riverHeight;
  const RIVER_TOP = () => RIVER_Y() - RIVER_H() / 2;
  const RIVER_BOTTOM = () => RIVER_Y() + RIVER_H() / 2;

  const BRIDGE_LEFT_X = () => gameContainer.offsetWidth * MAP_CONFIG.bridgeLeftX + gameContainer.offsetWidth * MAP_CONFIG.bridgeWidth / 2;
  const BRIDGE_RIGHT_X = () => gameContainer.offsetWidth * MAP_CONFIG.bridgeRightX - gameContainer.offsetWidth * MAP_CONFIG.bridgeWidth / 2;
  const BRIDGE_HALF_W = () => gameContainer.offsetWidth * MAP_CONFIG.bridgeWidth / 2;

  function centerOf(el){ const gr=gameContainer.getBoundingClientRect(); const r=el.getBoundingClientRect(); return { x:(r.left+r.right)/2-gr.left, y:(r.top+r.bottom)/2-gr.top }; }
  function getLane(el){ const gr=gameContainer.getBoundingClientRect(); const r=el.getBoundingClientRect(); const cx=(r.left+r.right)/2; const xp=((cx-gr.left)/gr.width)*100; return xp<50?'left':'right'; }
  function getDistance(aEl,bEl){ const a=centerOf(aEl), b=centerOf(bEl); return Math.hypot(a.x-b.x, a.y-b.y); }
  function getPrincess(owner, lane){ return entities[`${owner}-princess-tower-${lane}`] || null; }

  // ===== Deck helpers =====
  function createFreshDeck(){
    // 以模板複製，避免改到配置本身
    return {
      player: [...DECK_TEMPLATE.player],
      enemy:  [...DECK_TEMPLATE.enemy]
    };
  }
  function shuffleDeck(owner){
    for(let i=currentDeck[owner].length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      [currentDeck[owner][i],currentDeck[owner][j]]=[currentDeck[owner][j],currentDeck[owner][i]];
    }
  }
  function drawCard(owner){
    if(currentDeck[owner].length>0 && hand[owner].length<4){
      hand[owner].push(currentDeck[owner].pop());
    }
  }

  // ===== Init / Restart =====
  function initGame(){
    // 建塔
    ['player','enemy'].forEach(owner => {
      createTower(owner,'king-tower',BUILDINGS['king-tower'].hp);
      createTower(owner,'princess-tower-left',BUILDINGS['princess-tower'].hp);
      createTower(owner,'princess-tower-right',BUILDINGS['princess-tower'].hp);
    });

    // 牌庫
    ['player','enemy'].forEach(owner => {
      shuffleDeck(owner);
      for(let i=0;i<4;i++) drawCard(owner);
    });

    updateHandUI();

    // 啟動循環
    elixirInterval = setInterval(regenerateElixir, GAME_CONFIG.elixirRegenIntervalMs);
    gameLoopInterval = setInterval(gameLoop, FRAME_TIME);
    aiInterval = setInterval(aiTurn, 2000);

    // 事件只綁一次
    if(!listenersBound){
      gameContainer.addEventListener('click', handleDeploymentClick);
      gameContainer.addEventListener('mousemove', handleDeploymentMouseMove);
      listenersBound = true;
    }
  }

  function resetGameState(){
    // 清 interval
    if (gameLoopInterval) clearInterval(gameLoopInterval);
    if (elixirInterval) clearInterval(elixirInterval);
    if (aiInterval) clearInterval(aiInterval);

    // 清場景
    entitiesContainer.innerHTML = '';
    handContainer.innerHTML = '';
    messageBox.style.display = 'none';
    messageBox.innerHTML = '';

    // 重置變數
    entities = {};
    elixir = { player: GAME_CONFIG.initialElixir, enemy: GAME_CONFIG.initialElixir };
    currentDeck = createFreshDeck();
    hand = { player: [], enemy: [] };
    isGameOver = false;
    nextEntityId = 0;
    activeCardToDeploy = null;

    // 重置 UI
    updateElixirUI();
    dragPreview.style.display = 'none';
  }

  function restartGame(){
    resetGameState();
    initGame();
  }

  // ===== Create Tower =====
  function createTower(owner, type, hp){
    const id = `${owner}-${type}`;
    const el=document.createElement('div');
    el.id=id;
    el.className=`tower ${type.includes('king')?'king-tower':'princess-tower'}`;
    el.innerHTML='<div class="health-bar-container"><div class="health-bar"></div></div>';
    const pos=BUILDING_POSITIONS[id];
    el.style.position='absolute';
    el.style.left=pos.x;
    el.style.top=pos.y;
    el.style.transform='translate(-50%, -50%)';
    entitiesContainer.appendChild(el);
    const bcfg = BUILDINGS[type.includes('king') ? 'king-tower' : 'princess-tower'];
    entities[id] = { id, owner, type:'TOWER', hp, maxHp:hp, element:el, isAttacking:false, attackInterval:null, class:type,
      range: bcfg.range, sightRange: bcfg.range + 0.5, targets:['ground','air'], damage: bcfg.damage, attackSpeed: bcfg.attackSpeed };
    updateHealthBar(entities[id]);
  }

  // ===== UI =====
  function updateHandUI(){
    handContainer.innerHTML='';
    hand.player.forEach((cardId, index)=>{
      const card=CARDS[cardId];
      const div=document.createElement('div');
      div.className=`card ${card.class}`;
      if(activeCardToDeploy && activeCardToDeploy.handIndex===index) div.classList.add('selected');
      div.innerHTML=`<div class="card-cost">${card.cost}</div><div class="card-name">${card.name}</div><div class="card-icon">${card.type==='SPELL'?'🔥':'🤺'}</div>`;
      if(elixir.player<card.cost) div.classList.add('disabled');
      div.onclick=(e)=>{ e.stopPropagation(); trySelectCard(cardId,index); };
      handContainer.appendChild(div);
    });
  }
  function updateElixirUI(){
    elixirText.textContent=Math.floor(elixir.player);
    elixirBar.style.width=(elixir.player/GAME_CONFIG.maxElixir)*100+'%';
  }

  // ===== Elixir =====
  function regenerateElixir(){
    Object.keys(elixir).forEach(o=>{ if(elixir[o]<GAME_CONFIG.maxElixir) elixir[o]+=GAME_CONFIG.elixirRegenPerSecond; });
    updateElixirUI();
    updateHandUI();
  }

  // ===== Hand / Play =====
  function trySelectCard(cardId, handIndex){
    if(isGameOver) return;
    const c=CARDS[cardId];
    if(elixir.player>=c.cost){
      if(activeCardToDeploy && activeCardToDeploy.handIndex===handIndex){ cancelDeployment(); }
      else { activeCardToDeploy={cardId,handIndex,cardData:c}; dragPreview.style.display='block'; updateHandUI(); }
    }
  }
  function handleDeploymentClick(evt){
    if(!activeCardToDeploy) return;
    const rect=gameContainer.getBoundingClientRect();
    const y=evt.clientY-rect.top;
    const riverBottom=RIVER_BOTTOM();
    if(y>riverBottom || activeCardToDeploy.cardData.type==='SPELL'){
      const x=evt.clientX-rect.left;
      const pos={x,y};
      elixir.player -= activeCardToDeploy.cardData.cost;
      playCard('player', activeCardToDeploy.cardId, activeCardToDeploy.handIndex);
      if(activeCardToDeploy.cardData.type==='TROOP') deployUnit(activeCardToDeploy.cardData,'player',pos);
      else castSpell(activeCardToDeploy.cardData,pos);
      cancelDeployment();
    }
  }
  function handleDeploymentMouseMove(evt){
    if(activeCardToDeploy){
      const rect=gameContainer.getBoundingClientRect();
      dragPreview.style.left=(evt.clientX-rect.left-dragPreview.offsetWidth/2)+'px';
      dragPreview.style.top=(evt.clientY-rect.top-dragPreview.offsetHeight/2)+'px';
    }
  }
  function cancelDeployment(){ activeCardToDeploy=null; dragPreview.style.display='none'; updateHandUI(); }
  function playCard(owner,cardId,handIndex){
    const played=hand[owner].splice(handIndex,1)[0];
    currentDeck[owner].unshift(played);
    drawCard(owner);
    if(owner==='player'){ updateElixirUI(); updateHandUI(); }
  }

  // ===== Entities =====
  function deployUnit(cardData, owner, position){
    const id=`unit-${nextEntityId++}`;
    const el=document.createElement('div');
    el.id=id;
    el.className=`unit ${owner} ${cardData.class}`;
    el.innerHTML='<div class="health-bar-container"><div class="health-bar"></div></div><div class="unit-body"></div>';
    el.style.position='absolute';
    if(position){ el.style.left=position.x+'px'; el.style.top=position.y+'px'; }
    else { const isLeft=Math.random()<0.5; el.style.left=(isLeft?'25%':'75%'); el.style.top='40%'; }
    el.style.transform='translate(-50%, -50%)';
    entitiesContainer.appendChild(el);
    const ent={ id, owner, ...cardData, type:'TROOP', hp:cardData.hp, maxHp:cardData.hp, element:el, isAttacking:false, attackInterval:null, targetId:null, isDying:false, dyingTimer:0, lane:getLane(el) };
    entities[id]=ent;
    ent.bridgePhase=0; ent.bridgeWaypoints=null;
    updateHealthBar(ent);
    if(cardData.class==='giant'){ const enemy=owner==='player'?'enemy':'player'; const b=findClosestBuilding(ent, enemy); if(b) ent.targetId=b.id; }
  }

  function castSpell(cardData, position){
    const e=document.createElement('div');
    e.style.cssText=`position:absolute; left:${position.x-50}px; top:${position.y-50}px; width:100px; height:100px; background:radial-gradient(circle, rgba(255,165,0,.8) 0%, rgba(255,69,0,0) 70%); border-radius:50%; z-index:99;`;
    entitiesContainer.appendChild(e);
    setTimeout(()=>e.remove(),500);
    Object.values(entities).forEach(ent=>{
      if(ent.owner!=='player' && ent.hp>0){
        const er=ent.element.getBoundingClientRect();
        const gr=gameContainer.getBoundingClientRect();
        const ex=er.left-gr.left+er.width/2;
        const ey=er.top-gr.top+er.height/2;
        const d=Math.hypot(position.x-ex, position.y-ey);
        if(d < cardData.radius*20) dealDamage(ent, cardData.damage);
      }
    });
  }

  // ===== Targeting =====
  function canTarget(attacker, target){
    if(!attacker || !target) return false;
    const t = Array.isArray(attacker.targets) ? attacker.targets : [];
    if(target.type === 'TROOP') return t.includes('ground') || t.includes('air');
    if(target.type === 'TOWER') return t.includes('buildings');
    return false;
  }

  function findTarget(entity){
    const cur = entity.targetId ? entities[entity.targetId] : null;
    const curAlive = !!(cur && cur.hp > 0);
    if (curAlive && entity.isAttacking) return;

    const enemy = entity.owner === 'player' ? 'enemy' : 'player';
    const sightPx = (entity.sightRange || 0) * pxPerTile();

    if (entity.targets && (entity.targets.includes('ground') || entity.targets.includes('air'))){
      const troop = Object.values(entities)
        .filter(e => e.owner === enemy && e.type === 'TROOP' && e.hp > 0 && getDistance(entity.element, e.element) <= sightPx)
        .sort((a, b) => getDistance(entity.element, a.element) - getDistance(entity.element, b.element))[0];
      if (troop) {
        if (!curAlive || cur.type === 'TOWER') { entity.targetId = troop.id; return; }
      }
    }

    if (curAlive) return;

    if (entity.targets?.includes('buildings')){
      const b = findClosestBuilding(entity, enemy);
      if (b) { entity.targetId = b.id; return; }
    }
    entity.targetId = null;
  }

  function findClosestBuilding(entity, enemy){
    const L = entities[`${enemy}-princess-tower-left`];
    const R = entities[`${enemy}-princess-tower-right`];
    const K = entities[`${enemy}-king-tower`];
  
    const same  = (entity.lane === 'left') ? L : R;
    const other = (entity.lane === 'left') ? R : L;
  
    // 1) 同路公主塔還在 → 打同路
    if (same && same.hp > 0) return same;
  
    // 2) 同路塔倒了 → 先打國王塔（不比距離）
    if (K && K.hp > 0) return K;
  
    // 3) 國王塔不在（理論上不會發生，或特殊規則）→ 才打另一側公主塔
    if (other && other.hp > 0) return other;
  
    return null;
  }
  

  // ===== Movement =====
  function distanceToPoint(el, p){ const c=centerOf(el); return Math.hypot(c.x-p.x, c.y-p.y); }

  function planBridgeWaypoints(entity){
    const goingUp = entity.owner === 'player';
    const bridgeX = (entity.lane === 'left') ? BRIDGE_LEFT_X() : BRIDGE_RIGHT_X();
    const entryY  = goingUp ? (RIVER_BOTTOM() - 2) : (RIVER_TOP() + 2);
    const exitY   = goingUp ? (RIVER_TOP() + 2)  : (RIVER_BOTTOM() - 2);
    entity.bridgeWaypoints = [{x:bridgeX, y:entryY}, {x:bridgeX, y:exitY}];
    entity.bridgePhase = 1;
  }

  function computeGuidePoint(entity, finalTarget){
    const ec = centerOf(entity.element);
    const tc = centerOf(finalTarget.element);
    const goingUp = entity.owner === 'player';
    const beforeRiver = goingUp ? (ec.y > RIVER_BOTTOM()) : (ec.y < RIVER_TOP());
    const targetAcross = goingUp ? (tc.y < RIVER_TOP()) : (tc.y > RIVER_BOTTOM());

    const selfPrincess = getPrincess(entity.owner, entity.lane);
    if (selfPrincess){
      const pc = centerOf(selfPrincess.element);
      const behind = goingUp ? (ec.y > pc.y) : (ec.y < pc.y);
      if (behind && entity.bridgePhase===0) return pc;
    }

    if (targetAcross && beforeRiver){
      if(entity.bridgePhase===0) planBridgeWaypoints(entity);
      const idx = entity.bridgePhase===1 ? 0 : 1;
      return entity.bridgeWaypoints[idx];
    }

    if(entity.bridgePhase!==0){ entity.bridgePhase=0; entity.bridgeWaypoints=null; }
    return tc;
  }

  function moveTowards(entity, finalTarget){
    const v  = speedPx(entity);
    const gp = computeGuidePoint(entity, finalTarget);
    const ec = centerOf(entity.element);

    const inRiverBand = (ec.y > RIVER_TOP() && ec.y < RIVER_BOTTOM());
    if(inRiverBand){
      const bridgeX = (entity.lane === 'left') ? BRIDGE_LEFT_X() : BRIDGE_RIGHT_X();
      if (Math.abs(ec.x - bridgeX) > BRIDGE_HALF_W()*0.9) {
        gp.x = bridgeX;
      }
    }

    const ang = Math.atan2(gp.y - ec.y, gp.x - ec.x);
    const dx  = Math.cos(ang) * v;
    const dy  = Math.sin(ang) * v;

    const eps = Math.max(v * 1.25, 4);
    if(distanceToPoint(entity.element, gp) <= eps){
      entity.element.style.left = (entity.element.offsetLeft + (gp.x - ec.x)) + 'px';
      entity.element.style.top  = (entity.element.offsetTop  + (gp.y - ec.y)) + 'px';
      if(entity.bridgePhase===1) entity.bridgePhase=2; else if(entity.bridgePhase===2) { entity.bridgePhase=0; entity.bridgeWaypoints=null; }
      return;
    }

    entity.element.style.left = (entity.element.offsetLeft + dx) + 'px';
    entity.element.style.top  = (entity.element.offsetTop  + dy) + 'px';
  }

  // ===== Combat =====
  function startAttacking(entity, target){
    if(!canTarget(entity,target)) return;
    entity.isAttacking=true;
    entity.attackInterval=setInterval(()=>{
      if(isGameOver || entity.hp<=0 || !entities[target.id] || entities[target.id].hp<=0 || !canTarget(entity,target)){
        stopAttacking(entity); return;
      }
      const body=entity.element.querySelector('.unit-body')||entity.element;
      body.classList.add('is-attacking'); setTimeout(()=>body.classList.remove('is-attacking'),300);
      dealDamage(target, entity.damage);
    }, (entity.attackSpeed||1.0)*1000);
  }
  function stopAttacking(entity){ if(entity.attackInterval) clearInterval(entity.attackInterval); entity.isAttacking=false; entity.attackInterval=null; }
  function dealDamage(target, dmg){
    target.hp -= dmg;
    const body=target.element.querySelector('.unit-body')||target.element;
    body.classList.add('is-damaged'); setTimeout(()=>body.classList.remove('is-damaged'),200);
    updateHealthBar(target);
    if(target.hp<=0) handleDeath(target);
  }
  function updateHealthBar(entity){
    const hb=entity.element.querySelector('.health-bar');
    if(hb){ const p=Math.max(0,(entity.hp/entity.maxHp)*100); hb.style.width=p+'%'; }
  }
  function handleDeath(entity){
    entity.hp=0;
    if(entity.attackInterval) stopAttacking(entity);
    entity.isDying=true; entity.dyingTimer=300;
    if(entity.class==='king-tower'){
      isGameOver=true;
      showEndMessage(entity.owner==='enemy'?'WIN':'LOSE');
      clearInterval(gameLoopInterval); clearInterval(elixirInterval); clearInterval(aiInterval);
    }
  }
  function processTower(t){
    const enemy=t.owner==='player'?'enemy':'player';
    const sightPx=(t.sightRange||7.5)*pxPerTile();
    const atkPx=(t.range||7)*pxPerTile();
    const target=Object.values(entities)
      .filter(e=> e.owner===enemy && e.type==='TROOP' && e.hp>0 && getDistance(t.element,e.element)<=sightPx)
      .sort((a,b)=> getDistance(t.element,a.element)-getDistance(t.element,b.element))[0];
    if(!target){ if(t.isAttacking) stopAttacking(t); t.targetId=null; return; }
    t.targetId=target.id;
    const d=getDistance(t.element,target.element);
    if(d<=atkPx){ if(!t.isAttacking) startAttacking(t,target); }
    else if(t.isAttacking) stopAttacking(t);
  }

  // ===== Game Loop =====
  function gameLoop(){
    if(isGameOver) return;
    Object.values(entities).forEach(entity=>{
      if(entity.isDying){
        entity.dyingTimer-=FRAME_TIME;
        entity.element.style.opacity=Math.max(0, entity.dyingTimer/500);
        if(entity.dyingTimer<=0){ if(entity.element) entity.element.remove(); delete entities[entity.id]; }
        return;
      }
      if(entity.hp<=0) return;

      if(entity.targetId && (!entities[entity.targetId] || entities[entity.targetId].hp<=0)){
        if(entity.isAttacking) stopAttacking(entity);
        entity.targetId=null;
      }

      if(entity.type==='TOWER'){ processTower(entity); return; }

      findTarget(entity);

      if(entity.targetId && entities[entity.targetId]){
        const target=entities[entity.targetId];
        const atkPx=(entity.range||0)*pxPerTile();
        const dist = getDistance(entity.element, target.element);
        if(canTarget(entity,target) && dist<=atkPx){ if(!entity.isAttacking) startAttacking(entity,target); }
        else { if(entity.isAttacking) stopAttacking(entity); moveTowards(entity,target); }
      } else { if(entity.isAttacking) stopAttacking(entity); }
    });
  }

  // ===== AI =====
  function aiTurn(){
    if(isGameOver) return;
    const can=hand.enemy.map((cid,idx)=>({cid,idx,cost:CARDS[cid].cost})).filter(c=> elixir.enemy>=c.cost);
    if(can.length>0){
      const pick=can[Math.floor(Math.random()*can.length)];
      elixir.enemy -= pick.cost;
      playCard('enemy', pick.cid, pick.idx);
      const cd=CARDS[pick.cid];
      if(cd.type==='TROOP') deployUnit(cd,'enemy');
    }
  }

  // ===== End Message =====
  function showEndMessage(msg){
    messageBox.innerHTML = `
      <div style="margin-bottom:8px;">${msg}</div>
      <button id="btn-restart" class="btn-restart">再玩一次</button>
    `;
    messageBox.style.display = 'block';
    const btn = document.getElementById('btn-restart');
    if (btn){
      btn.onclick = (e) => { e.stopPropagation(); restartGame(); };
    }
  }

  // ===== Boot =====
  initGame();
});
