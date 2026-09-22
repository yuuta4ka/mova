import assert from 'node:assert/strict';

export async function installPortraitCamera(page) {
  await page.evaluate(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (!constraints?.video) return capture(constraints);
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = 1040;
      const ctx = canvas.getContext('2d');
      const draw = () => { ctx.fillStyle='#769bad'; ctx.fillRect(0,0,480,1040); ctx.fillStyle='#e1b793'; ctx.beginPath(); ctx.ellipse(240,380,100,150,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#41445d';ctx.fillRect(60,550,360,490);ctx.fillStyle='#fff';ctx.font='24px sans-serif';ctx.fillText(String(Date.now()),30,60); };
      draw(); const stream=canvas.captureStream(15), timer=setInterval(draw,65);
      stream.getTracks().forEach(t=>t.addEventListener('ended',()=>clearInterval(timer)));
      return stream;
    };
  });
}

export async function verifyMobileCameras(caller, callee) {
  const page=caller.page, original=page.viewportSize();
  await page.setViewportSize({width:390,height:844});
  const grid=page.locator('.mova-call-grid.is-participants');
  const measure=async()=>page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
    const grid=document.querySelector('.mova-call-grid.is-participants');
    return {box:rect(grid),tiles:[...grid.querySelectorAll('.is-camera')].map(e=>({box:rect(e),fit:getComputedStyle(e.querySelector('video')).objectFit,buttons:e.querySelectorAll('.mova-call-fullscreen').length,video:rect(e.querySelector('video'))}))};
  });
  let result=await measure();
  assert.equal(result.tiles.length,2);
  for(const tile of result.tiles){assert.ok(tile.box.x>=result.box.x-1 && tile.box.right<=result.box.right+1,'Both inline cameras fit horizontally');assert.equal(tile.fit,'cover');assert.equal(tile.buttons,0);assert.ok(Math.abs(tile.video.height-tile.box.height)<3);}
  await grid.locator('.is-camera:not(.is-self)').click();
  await page.locator('.mova-real-thread.is-in-call:not(.is-call-inline)').waitFor();
  result=await measure();
  assert.ok(result.tiles[0].box.height>500,'Primary camera uses the full available height');
  const pip=page.locator('.mova-call-self-view');
  const before=await pip.boundingBox();
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2);await page.mouse.down();await page.mouse.move(80,240,{steps:10});await page.mouse.up();
  const after=await pip.boundingBox();assert.ok(after.x<before.x-50 && after.y<before.y-100,'PiP can be dragged');
  const cdp=await caller.context.newCDPSession(page);
  const x=after.x+20,y=after.y+40;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1},{x:x+50,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y,id:1},{x:x+100,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const resized=await pip.boundingBox();assert.ok(resized.width>after.width*1.5,'Two-finger pinch enlarges PiP');
  await page.setViewportSize({width:844,height:390});
  await page.waitForFunction(()=>{const e=document.querySelector('.mova-call-self-view'),p=e.parentElement.getBoundingClientRect(),r=e.getBoundingClientRect();return r.x>=p.x-1&&r.y>=p.y-1&&r.right<=p.right+1&&r.bottom<=p.bottom+1});
  const dock = await page.locator('.mova-call-controls').boundingBox();
  assert.ok(dock.y + dock.height <= 391, 'Call controls stay visible in landscape');
  await page.setViewportSize({width:390,height:844});
  await callee.page.getByRole('button',{name:'Выключить камеру',exact:true}).click();
  await page.locator('.mova-call-primary-participant>.is-camera.is-self').waitFor();
  assert.equal(await page.locator('.mova-call-self-view>.is-avatar').count(),1,'Remote avatar becomes secondary when only local camera is enabled');
  await page.getByRole('button',{name:'Выключить камеру',exact:true}).click();
  await grid.locator('.is-avatar').nth(1).waitFor();
  const portraits=await grid.locator('.is-avatar').evaluateAll(tiles=>tiles.map(t=>({image:t.querySelector('img').getBoundingClientRect().toJSON(),label:t.querySelector('.mova-call-label').getBoundingClientRect().toJSON()})));
  for(const {image,label} of portraits){assert.ok(image.width<=70,'Photo avatar stays compact');assert.ok(image.bottom<=label.top+1,'Name remains outside photo');}
  await page.getByRole('button',{name:'Вернуть чат под звонком',exact:true}).click();
  await page.setViewportSize(original);
  console.log('Mobile cameras: image avatars, two portrait feeds, tap expansion, PiP drag/pinch/orientation, single-camera priority verified');
}
