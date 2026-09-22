import assert from 'node:assert/strict';

// Synthetic capture replaces only the OS picker. Tracks still travel through
// Mova's real signalling, RTCPeerConnection and remote video elements.
export async function verifyCallMedia(caller, callee) {
  const installCapture = async (page, portrait) => page.evaluate((portrait) => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = portrait ? 480 : 1280;
      canvas.height = portrait ? 1040 : 720;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(15);
      const draw = () => {
        const {width:w,height:h} = canvas;
        ctx.fillStyle = '#dae5ed'; ctx.fillRect(0,0,w,h);
        ctx.fillStyle = '#324a61'; ctx.fillRect(0,0,w,70);
        ctx.fillStyle = '#ffffff'; ctx.font='24px sans-serif'; ctx.fillText('Mova · test screen',24,45);
        ctx.fillStyle = '#94b6cb'; ctx.fillRect(24,100,w-48,h-140);
        ctx.fillStyle = '#263f55'; ctx.fillText(new Date().toISOString(),36,150);
        ctx.fillStyle = '#b58183'; ctx.beginPath(); ctx.arc(w/2+Math.sin(Date.now()/700)*w/5,h/2,35,0,Math.PI*2); ctx.fill();
      };
      draw();
      const timer = setInterval(draw,65);
      window.__screenFixture = {canvas,stream,timer};
      stream.getTracks().forEach(track=>track.addEventListener('ended',()=>clearInterval(timer)));
      return stream;
    };
  }, portrait);
  await installCapture(caller.page,false);
  await installCapture(callee.page,true);
  const checkLayout = async (page, screens) => {
    await page.waitForFunction((screens) => {
      const tiles = [...document.querySelectorAll('.mova-call-screen-cell>.is-screen')];
      return tiles.length === screens && tiles.every(tile=>{
        const video=tile.querySelector('video');
        return video.videoWidth > 0 && video.readyState >= 2 && Math.abs(Number(tile.dataset.sourceAspectRatio)-video.videoWidth/video.videoHeight)<.02;
      });
    }, screens, {timeout:15000});
    await page.locator('.mova-call-screen-cell video').evaluateAll(videos=>Promise.all(videos.map(video=>new Promise(resolve=>video.requestVideoFrameCallback(()=>video.requestVideoFrameCallback(resolve))))));
    const measurements=await page.evaluate(()=>{
      const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
      const tiles=[...document.querySelectorAll('.mova-call-screen-cell>.is-screen')].map(e=>({box:rect(e),ratio:e.querySelector('video').videoWidth/e.querySelector('video').videoHeight}));
      const people=[...document.querySelectorAll('.mova-call-participants>.mova-call-tile')].map(e=>({box:rect(e),id:e.dataset.participantId,avatar:e.querySelector('.mova-avatar')?rect(e.querySelector('.mova-avatar')):null}));
      return {tiles,people};
    });
    assert.equal(measurements.people.length,2,'Both people remain present during sharing');
    assert.equal(new Set(measurements.people.map(p=>p.id)).size,2,'Each person has one rail tile');
    for(const {box,ratio} of measurements.tiles){
      assert.ok(box.width>50 && box.height>50,'Screen has usable area');
      assert.ok(Math.abs((box.width-2)/(box.height-2)-ratio)<.04,'Border follows source aspect ratio');
    }
    const [a,b]=measurements.people.map(p=>p.box);
    assert.ok(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,'Participant tiles never overlap');
    for(const {box,avatar} of measurements.people) if(avatar){
      assert.ok(avatar.y>=box.y-1 && avatar.bottom<=box.bottom+1,`Avatar is not vertically cropped: ${JSON.stringify({box,avatar})}`);
    }
  };
  await caller.page.getByRole('button',{name:'Показать экран',exact:true}).click();
  await Promise.all([checkLayout(caller.page,1),checkLayout(callee.page,1)]);
  await callee.page.getByRole('button',{name:'Показать экран',exact:true}).click();
  await Promise.all([checkLayout(caller.page,2),checkLayout(callee.page,2)]);
  if(process.env.MOVA_CALL_SCREENSHOT) await caller.page.screenshot({path:process.env.MOVA_CALL_SCREENSHOT.replace(/\.png$/i,'')+'-portrait.png'});
  // Metadata must follow an orientation change without restarting the call.
  await callee.page.evaluate(()=>{window.__screenFixture.canvas.width=1040;window.__screenFixture.canvas.height=480});
  await caller.page.waitForFunction(()=>[...document.querySelectorAll('.is-screen:not(.is-self) video')].some(v=>v.videoWidth>v.videoHeight));
  await checkLayout(caller.page,2);
  const originalViewport=caller.page.viewportSize();
  for(const viewport of [{width:1440,height:1000},{width:1000,height:720},{width:390,height:844}]){
    await caller.page.setViewportSize(viewport);
    if(viewport.width===390){
      await caller.page.locator('main.is-mobile-navigation.is-mobile-chat').waitFor();
      assert.equal(await caller.page.locator('.mova-real-thread').getAttribute('inert'),null,'Resizing keeps the active call interactive');
    }
    await checkLayout(caller.page,2);
    if(process.env.MOVA_CALL_SCREENSHOT) await caller.page.screenshot({path:process.env.MOVA_CALL_SCREENSHOT.replace(/\.png$/i,'')+`-media-${viewport.width}.png`});
  }
  const resizer=caller.page.getByRole('separator',{name:'Изменить высоту звонка'});
  for(let i=0;i<13;i++) await resizer.press('ArrowUp');
  await checkLayout(caller.page,2);
  if(process.env.MOVA_CALL_SCREENSHOT) await caller.page.screenshot({path:process.env.MOVA_CALL_SCREENSHOT.replace(/\.png$/i,'')+'-media-compact.png'});
  await resizer.dblclick();
  await caller.page.locator('.mova-call-screen-cell>.is-screen').first().click();
  await caller.page.locator('.mova-call-tile.is-expanded').waitFor();
  await caller.page.waitForFunction(()=>{const e=document.querySelector('.mova-call-tile.is-expanded');if(!e)return false;if(e.getAnimations().some(a=>a.playState==='running'))return false;const r=e.getBoundingClientRect();return Math.abs(r.x)<1 && Math.abs(r.y)<1 && Math.abs(r.width-innerWidth)<1 && Math.abs(r.height-innerHeight)<1});
  const full=await caller.page.locator('.mova-call-tile.is-expanded').boundingBox();
  assert.ok(Math.abs(full.x)<1 && Math.abs(full.y)<1 && Math.abs(full.width-390)<1 && Math.abs(full.height-844)<1,`Mobile fullscreen fills the viewport without card clipping: ${JSON.stringify(full)}`);
  if(process.env.MOVA_CALL_SCREENSHOT) await caller.page.screenshot({path:process.env.MOVA_CALL_SCREENSHOT.replace(/\.png$/i,'')+'-media-fullscreen.png'});
  await caller.page.keyboard.press('Escape');
  await caller.page.locator('.mova-call-tile.is-expanded').waitFor({state:'hidden'});
  await caller.page.setViewportSize(originalViewport);
  for(const client of [callee,caller]){
    await client.page.getByRole('button',{name:'Настроить демонстрацию',exact:true}).click();
    await client.page.getByRole('button',{name:'Выключить демонстрацию',exact:true}).click();
  }
  await Promise.all([caller.page,callee.page].map(p=>p.locator('.mova-call-grid.is-participants').waitFor()));
  console.log('Screen media: local + remote, simultaneous sources, orientation, responsive geometry and fullscreen verified');
}
