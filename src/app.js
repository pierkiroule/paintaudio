import { initMic, readBands } from './audio.js'
import { BrushRibbon } from './brushes.js'

const DRAW_BASE_DIST = 1.1

AFRAME.registerComponent('brush-rig', {
  init() {
    this.world = document.getElementById('world')
    this.status = document.getElementById('status')
    this.cursor = document.getElementById('drawCursor')
    this.camera = this.el.querySelector('a-camera')
    this.analyser = null
    this.fft = null
    this.t = 0

    this.pos = this.el.object3D.position.clone()
    this.vel = new THREE.Vector3()
    this.target = new THREE.Vector3()
    this.dir = new THREE.Vector3()

    this.camWorldPos = new THREE.Vector3()
    this.camWorldQuat = new THREE.Quaternion()
    this.dirFwd = new THREE.Vector3()
    this.dirRight = new THREE.Vector3()
    this.dirUp = new THREE.Vector3()

    this.drawDist = DRAW_BASE_DIST
    this.drawDistTarget = DRAW_BASE_DIST
    this.pitch = 0
    this.roll = 0
    this.audioSmooth = { low: 0, mid: 0, high: 0, energy: 0 }

    this.ribbon = new BrushRibbon({
      world: this.world,
      maxControlPoints: 5,
      sampleCount: 40,
      baseWidth: 0.06,
      baseOpacity: 0.08
    })
    this.drawingEnabled = true

    const micBtn = document.getElementById('micBtn')
    micBtn.addEventListener('click', async () => {
      if (this.analyser) return
      const a = await initMic()
      this.analyser = a.analyser
      this.fft = a.fft
      this.status.textContent = 'mic:on'
    })

  },

  setDrawingEnabled(enabled) {
    this.drawingEnabled = enabled
  },

  tick(t, dt) {
    const dts = dt * 0.001
    this.t += dts

    const bandsRaw = (this.analyser && this.fft)
      ? readBands(this.analyser, this.fft)
      : { low: 0, mid: 0, high: 0, energy: 0 }
    const audioBlend = 1 - Math.exp(-dt * 0.004)
    this.audioSmooth.low = THREE.MathUtils.lerp(this.audioSmooth.low, bandsRaw.low, audioBlend)
    this.audioSmooth.mid = THREE.MathUtils.lerp(this.audioSmooth.mid, bandsRaw.mid, audioBlend)
    this.audioSmooth.high = THREE.MathUtils.lerp(this.audioSmooth.high, bandsRaw.high, audioBlend)
    this.audioSmooth.energy = THREE.MathUtils.lerp(this.audioSmooth.energy, bandsRaw.energy, audioBlend)
    const b = this.audioSmooth

    if (this.analyser) {
      this.status.textContent = `mic:on ${b.energy.toFixed(2)}`
    }

    if (!this.drawingEnabled) {
      return
    }

    // mouvement caméra plus varié, synchronisé à l’audio
    const orbitSlow = 1.8 + Math.sin(this.t * 0.08) * 0.6
    const orbitFast = 0.9 + Math.sin(this.t * 0.24 + Math.sin(this.t * 0.05)) * 0.45
    const sway = 1 + b.energy * 0.75 + b.high * 0.35
    const angle = this.t * (0.12 + b.energy * 0.08) + Math.sin(this.t * 0.07) * 0.5
    const tilt = Math.sin(this.t * 0.3) * 0.35 + Math.cos(this.t * 0.18) * 0.2

    this.target.set(
      Math.cos(angle) * orbitSlow * sway + Math.sin(this.t * 0.4) * orbitFast,
      1.45 + Math.sin(this.t * 0.21) * 0.22 * sway + tilt * 0.3,
      3.0 + Math.sin(angle) * orbitSlow * sway + Math.cos(this.t * 0.36) * orbitFast
    )

    this.dir.copy(this.target).sub(this.pos)
    this.vel.multiplyScalar(0.92)
    this.vel.addScaledVector(this.dir, 0.15 * dts)
    this.pos.add(this.vel)
    this.el.object3D.position.copy(this.pos)

    // orientation douce (pas de lookAt brutal) avec variations
    this.el.object3D.rotation.y += Math.sin(this.t * 0.1) * 0.0011 * (1 + b.energy * 0.7)
    this.el.object3D.rotation.y += Math.sin(this.t * 0.28 + b.high * 1.5) * 0.0007

    const rotBlend = 1 - Math.exp(-dt * 0.0025)
    const pitchTarget = Math.sin(this.t * 0.12) * 0.24 +
      Math.sin(this.t * 0.32) * 0.12 +
      Math.sin(this.t * 0.48) * 0.06 +
      b.high * 0.08
    const rollTarget = Math.cos(this.t * 0.17) * 0.12 +
      Math.sin(this.t * 0.27) * 0.08 -
      b.low * 0.05
    this.pitch = THREE.MathUtils.lerp(this.pitch, pitchTarget, rotBlend)
    this.roll = THREE.MathUtils.lerp(this.roll, rollTarget, rotBlend)
    if (this.camera) {
      this.camera.object3D.rotation.x = this.pitch
      this.camera.object3D.rotation.z = this.roll
    }

    // distance de dessin modulée par l’audio
    this.drawDistTarget = DRAW_BASE_DIST + b.mid * 0.9 - b.low * 0.35
    this.drawDist = THREE.MathUtils.lerp(this.drawDist, this.drawDistTarget, 0.04)
    if (this.cursor) {
      this.cursor.object3D.position.z = -this.drawDist
    }

    // calcul du point DEVANT la caméra
    const camObj = this.camera?.object3D || this.el.object3D
    camObj.getWorldPosition(this.camWorldPos)
    camObj.getWorldQuaternion(this.camWorldQuat)
    this.dirFwd.set(0, 0, -1).applyQuaternion(this.camWorldQuat)
    this.dirRight.set(1, 0, 0).applyQuaternion(this.camWorldQuat)
    this.dirUp.set(0, 1, 0).applyQuaternion(this.camWorldQuat)

    const drawPos = this.camWorldPos
      .clone()
      .addScaledVector(this.dirFwd, this.drawDist)
    this.ribbon.update(drawPos, b, t)
  }
})

AFRAME.registerComponent('tpv-controls', {
  schema: {
    enabled: { default: false },
    minPolar: { default: -0.45 },
    maxPolar: { default: 0.45 },
    minRadius: { default: 2.2 },
    maxRadius: { default: 10 }
  },

  init() {
    this.target = new THREE.Vector3()
    this.current = { yaw: 0, pitch: 0.1, radius: 5 }
    this.desired = { yaw: 0, pitch: 0.1, radius: 5 }
    this.dragging = false
    this.pointerPositions = new Map()
    this.lastPinchDistance = null
    this.lastInteraction = performance.now()

    this.onPointerDown = this.onPointerDown.bind(this)
    this.onPointerMove = this.onPointerMove.bind(this)
    this.onPointerUp = this.onPointerUp.bind(this)
    this.onWheel = this.onWheel.bind(this)

    if (this.el.sceneEl?.canvas) {
      this.attachEvents()
    } else {
      this.el.sceneEl?.addEventListener('render-target-loaded', () => {
        this.attachEvents()
      })
    }
  },

  attachEvents() {
    const canvas = this.el.sceneEl?.canvas
    if (!canvas) return

    canvas.addEventListener('pointerdown', this.onPointerDown, { passive: true })
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: true })
    canvas.addEventListener('pointerup', this.onPointerUp, { passive: true })
    canvas.addEventListener('pointercancel', this.onPointerUp, { passive: true })
    canvas.addEventListener('wheel', this.onWheel, { passive: true })
  },

  setTarget(target, radius) {
    this.target.copy(target)
    if (typeof radius === 'number') {
      this.current.radius = radius
      this.desired.radius = radius
    }
  },

  setEnabled(enabled) {
    this.data.enabled = enabled
    if (!enabled) {
      this.dragging = false
      this.pointerPositions.clear()
      this.lastPinchDistance = null
    }
  },

  onPointerDown(event) {
    if (!this.data.enabled) return
    this.el.sceneEl?.canvas?.setPointerCapture(event.pointerId)
    this.pointerPositions.set(event.pointerId, { x: event.clientX, y: event.clientY })
    this.dragging = true
    this.lastInteraction = performance.now()
  },

  onPointerMove(event) {
    if (!this.data.enabled || !this.pointerPositions.has(event.pointerId)) return

    const prev = this.pointerPositions.get(event.pointerId)
    const next = { x: event.clientX, y: event.clientY }
    this.pointerPositions.set(event.pointerId, next)
    this.lastInteraction = performance.now()

    if (this.pointerPositions.size === 2) {
      const points = Array.from(this.pointerPositions.values())
      const dx = points[0].x - points[1].x
      const dy = points[0].y - points[1].y
      const distance = Math.hypot(dx, dy)
      if (this.lastPinchDistance != null) {
        const delta = distance - this.lastPinchDistance
        this.desired.radius = THREE.MathUtils.clamp(
          this.desired.radius - delta * 0.01,
          this.data.minRadius,
          this.data.maxRadius
        )
      }
      this.lastPinchDistance = distance
      return
    }

    if (!prev) return
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    this.desired.yaw -= dx * 0.005
    this.desired.pitch = THREE.MathUtils.clamp(
      this.desired.pitch - dy * 0.004,
      this.data.minPolar,
      this.data.maxPolar
    )
  },

  onPointerUp(event) {
    if (!this.pointerPositions.has(event.pointerId)) return
    this.pointerPositions.delete(event.pointerId)
    if (this.pointerPositions.size < 2) {
      this.lastPinchDistance = null
    }
    if (this.pointerPositions.size === 0) {
      this.dragging = false
    }
  },

  onWheel(event) {
    if (!this.data.enabled) return
    this.desired.radius = THREE.MathUtils.clamp(
      this.desired.radius + event.deltaY * 0.002,
      this.data.minRadius,
      this.data.maxRadius
    )
    this.lastInteraction = performance.now()
  },

  tick(time, dt) {
    if (!this.data.enabled) return

    const now = performance.now()
    if (!this.dragging && now - this.lastInteraction > 1600) {
      this.desired.yaw += dt * 0.00012
    }

    const smoothing = 1 - Math.exp(-dt * 0.01)
    this.current.yaw = THREE.MathUtils.lerp(this.current.yaw, this.desired.yaw, smoothing)
    this.current.pitch = THREE.MathUtils.lerp(this.current.pitch, this.desired.pitch, smoothing)
    this.current.radius = THREE.MathUtils.lerp(this.current.radius, this.desired.radius, smoothing)

    const phi = Math.PI * 0.5 - this.current.pitch
    const theta = this.current.yaw
    const pos = new THREE.Vector3()
    pos.setFromSphericalCoords(this.current.radius, phi, theta)
    pos.add(this.target)

    this.el.object3D.position.copy(pos)
    this.el.object3D.lookAt(this.target)
  }
})

AFRAME.registerComponent('view-switch', {
  init() {
    this.world = document.getElementById('world')
    this.rig = document.getElementById('rig')
    this.drawCam = document.getElementById('drawCam')
    this.previewRig = document.getElementById('previewRig')
    this.previewCam = document.getElementById('previewCam')
    this.orthoRig = document.getElementById('orthoRig')
    this.orthoCam = document.getElementById('orthoCam')
    this.toggleBtn = document.getElementById('viewToggle')
    this.modeToggle = document.getElementById('modeToggle')
    this.scene = this.el.sceneEl

    this.mode = 'fpv'
    this.dimension = '3d'
    this.worldBasePos = this.world.object3D.position.clone()
    this.worldOffset = new THREE.Vector3()
    this.worldBox = new THREE.Box3()
    this.worldSize = new THREE.Vector3()
    this.worldCenter = new THREE.Vector3()
    this.tpvTarget = new THREE.Vector3()
    this.orthoTarget = new THREE.Vector3()

    this.setViewMode = this.setViewMode.bind(this)
    this.setDimensionMode = this.setDimensionMode.bind(this)
    this.applyMode = this.applyMode.bind(this)

    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => {
        if (this.dimension !== '3d') return
        const next = this.mode === 'fpv' ? 'tpv' : 'fpv'
        this.setViewMode(next)
      })
    }

    if (this.modeToggle) {
      this.modeToggle.addEventListener('click', () => {
        const next = this.dimension === '3d' ? '2d' : '3d'
        this.setDimensionMode(next)
      })
    }

    this.applyMode({ immediate: true })
    window.setViewMode = this.setViewMode
  },

  setViewMode(mode, { immediate = false } = {}) {
    if (mode === this.mode) return
    this.mode = mode
    if (this.dimension !== '3d') return
    this.applyMode({ immediate })
  },

  setDimensionMode(mode, { immediate = false } = {}) {
    if (mode === this.dimension) return
    this.dimension = mode
    this.applyMode({ immediate })
  },

  applyMode({ immediate = false } = {}) {
    const applyMode = () => {
      const enable2d = this.dimension === '2d'
      const enableTpv = !enable2d && this.mode === 'tpv'
      const enableFpv = !enable2d && this.mode === 'fpv'

      if (enableTpv) {
        this.centerWorldForPreview()
      } else if (enable2d) {
        this.centerWorldForOrtho()
      } else {
        this.restoreWorldCenter()
      }

      this.drawCam.setAttribute('camera', { active: enableFpv })
      this.previewCam.setAttribute('camera', { active: enableTpv })
      this.orthoCam.setAttribute('camera', { active: enable2d })

      const rigComponent = this.rig?.components['brush-rig']
      if (rigComponent) {
        rigComponent.setDrawingEnabled(enableFpv)
      }

      const tpvControls = this.previewRig?.components['tpv-controls']
      if (tpvControls) {
        tpvControls.setEnabled(enableTpv)
      }

      if (this.toggleBtn) {
        this.toggleBtn.textContent = enableTpv ? '🧿' : '👁'
        this.toggleBtn.setAttribute('aria-pressed', enableTpv ? 'true' : 'false')
        this.toggleBtn.disabled = enable2d
        this.toggleBtn.setAttribute('aria-hidden', enable2d ? 'true' : 'false')
      }

      if (this.modeToggle) {
        this.modeToggle.textContent = enable2d ? '3D' : '2D'
        this.modeToggle.setAttribute('aria-pressed', enable2d ? 'true' : 'false')
      }
    }

    if (immediate) {
      applyMode()
      return
    }

    document.body.classList.add('view-transition')
    setTimeout(() => {
      applyMode()
      setTimeout(() => {
        document.body.classList.remove('view-transition')
      }, 180)
    }, 120)
  },

  centerWorldForPreview() {
    this.worldBox.setFromObject(this.world.object3D)
    if (this.worldBox.isEmpty()) {
      this.worldCenter.set(0, 0, 0)
      this.worldSize.set(1, 1, 1)
    } else {
      this.worldBox.getCenter(this.worldCenter)
      this.worldBox.getSize(this.worldSize)
    }

    this.worldOffset.copy(this.worldCenter)
    this.world.object3D.position.copy(this.worldBasePos).sub(this.worldOffset)

    const radius = Math.max(this.worldSize.x, this.worldSize.y, this.worldSize.z)
    const distance = THREE.MathUtils.clamp(radius * 2.2, 2.8, 9)
    const targetY = this.worldSize.y * 0.12
    this.tpvTarget.set(0, targetY, 0)

    const tpvControls = this.previewRig?.components['tpv-controls']
    if (tpvControls) {
      tpvControls.setTarget(this.tpvTarget, distance)
    } else {
      this.previewRig.object3D.position.set(0, targetY, distance)
      this.previewRig.object3D.lookAt(this.tpvTarget)
    }
  },

  centerWorldForOrtho() {
    this.centerWorldForPreview()

    const radius = Math.max(this.worldSize.x, this.worldSize.z)
    const height = THREE.MathUtils.clamp(radius * 1.6 + 1.4, 2.6, 10)
    const orthoSize = Math.max(radius * 0.7 + 1.2, 2.8)

    this.orthoTarget.set(0, 0, 0)
    this.orthoRig.object3D.position.set(0, height, 0)
    this.orthoRig.object3D.lookAt(this.orthoTarget)

    this.orthoCam.setAttribute('camera', {
      projection: 'orthographic',
      orthographicSize: orthoSize
    })
  },

  restoreWorldCenter() {
    this.world.object3D.position.copy(this.worldBasePos)
  }
})
