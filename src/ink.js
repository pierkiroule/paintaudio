import * as THREE from 'three'

export function createInk(scene) {
  const COUNT = 1200
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(COUNT * 3)
  const vel = new Float32Array(COUNT * 3)

  function reset(i){
    const i3=i*3
    pos[i3]   = (Math.random()-0.5)*2
    pos[i3+1] = -6 - Math.random()*4
    pos[i3+2] = 0
    vel[i3]=vel[i3+1]=vel[i3+2]=0
  }

  for(let i=0;i<COUNT;i++) reset(i)
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3))

  // ⚠️ MATERIAL DEBUG ULTRA SIMPLE
  const mat = new THREE.PointsMaterial({
    color: 0x000000,
    size: 0.08,
    transparent: true,
    opacity: 1.0,
    depthWrite: false
  })

  const points = new THREE.Points(geo, mat)
  scene.add(points)

  console.log('INK POINTS ADDED', points)

  return { pos, vel, geo, mat, reset, COUNT }
}