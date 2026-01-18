export function animate({ renderer, scene, camera, paperMat, ink, audio, status }) {

  function frame(){
    requestAnimationFrame(frame)

    renderer.clearDepth()
    paperMat.uniforms.uTime.value += 0.01

    const b = audio ? audio() : { low:0, mid:0, high:0 }

    status.textContent =
      `low:${b.low.toFixed(2)} mid:${b.mid.toFixed(2)} high:${b.high.toFixed(2)}`

    const scroll = 0.02   // ⚠️ volontairement FORT pour debug

    for(let i=0;i<ink.COUNT;i++){
      const i3=i*3

      ink.pos[i3+1] += scroll
      ink.pos[i3] += Math.sin(ink.pos[i3+1]) * 0.05

      if(ink.pos[i3+1] > 6) ink.reset(i)
    }

    ink.geo.attributes.position.needsUpdate = true
    renderer.render(scene, camera)
  }

  frame()
}