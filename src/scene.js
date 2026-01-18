import * as THREE from 'three'

export function initScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.autoClear = false

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0xf2f0eb)

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  )
  camera.position.z = 6

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  })

  return { renderer, scene, camera }
}
