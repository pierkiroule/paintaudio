const TAU = Math.PI * 2

const clamp = (val, min, max) => Math.min(max, Math.max(min, val))
const lerp = (a, b, t) => a + (b - a) * t

function smoothNoise(t, seed) {
  const a = Math.sin(t * 0.6 + seed) * 0.6
  const b = Math.sin(t * 0.13 + seed * 2.17) * 0.4
  return clamp(0.5 + a + b, 0, 1)
}

function noiseSigned(t, seed) {
  return smoothNoise(t, seed) * 2 - 1
}

function palette(bands, hueShift = 0, energyBoost = 0) {
  const low = clamp(bands.low, 0, 1)
  const mid = clamp(bands.mid, 0, 1)
  const high = clamp(bands.high, 0, 1)
  const energy = clamp(bands.energy + energyBoost, 0, 1)

  const weight = low + mid + high + 0.0001
  const hue = ((
    24 * (low / weight) +
    140 * (mid / weight) +
    235 * (high / weight)
  ) + hueShift + 360) % 360
  const saturation = 35 + energy * 50
  const lightness = 22 + energy * 25
  const colorObj = new THREE.Color().setHSL(hue / 360, saturation / 100, lightness / 100)
  const emissiveObj = new THREE.Color().setHSL(
    ((hue + 18) % 360) / 360,
    (saturation + 10) / 100,
    (lightness + 8) / 100
  )
  const color = `#${colorObj.getHexString()}`
  const emissive = `#${emissiveObj.getHexString()}`
  const opacity = 0.18 + energy * 0.22
  return { color, emissive, opacity }
}

class BaseBrush {
  constructor({ world, maxStrokes = 240, seed = 1, hueShift = 0 }) {
    this.world = world
    this.maxStrokes = maxStrokes
    this.strokes = []
    this.seed = seed
    this.hueShift = hueShift
    this.spawnClock = 0
    this.elapsed = 0
    this.weight = 1
    this.targetWeight = 1
  }

  setWeight(target) {
    this.targetWeight = clamp(target, 0, 1)
  }

  updateWeight(dt) {
    const blend = 1 - Math.exp(-dt * 0.004)
    this.weight = lerp(this.weight, this.targetWeight, blend)
  }

  isFadedOut() {
    return this.weight < 0.03 && this.targetWeight < 0.03
  }

  addStroke(entity) {
    this.strokes.push(entity)
    if (this.strokes.length > this.maxStrokes) {
      const old = this.strokes.shift()
      old?.parentNode?.removeChild(old)
    }
  }

  dispose() {
    this.strokes.forEach((stroke) => stroke?.parentNode?.removeChild(stroke))
    this.strokes = []
  }
}

class InkBrush extends BaseBrush {
  update(audio, time, dt, pos, dir, right, up) {
    this.elapsed += dt * 0.001
    this.updateWeight(dt)
    if (this.weight < 0.02) return

    const density = clamp(audio.low * 1.25, 0, 1)
    const interval = lerp(190, 70, density)
    this.spawnClock += dt * (0.4 + this.weight)

    while (this.spawnClock >= interval) {
      this.spawnClock -= interval
      const t = this.elapsed
      const lineWiggle = noiseSigned(t, this.seed + 0.5) * audio.high
      const offset = new THREE.Vector3()
      offset
        .addScaledVector(right, lineWiggle * 0.02)
        .addScaledVector(up, noiseSigned(t, this.seed + 1.4) * 0.018)

      const jitterAmt = 0.01 + audio.high * 0.03
      offset.addScaledVector(right, noiseSigned(t, this.seed + 2.2) * jitterAmt)
      offset.addScaledVector(up, noiseSigned(t, this.seed + 3.1) * jitterAmt)

      const drawPos = pos.clone().add(offset)

      const thickness = 0.006 + audio.mid * 0.03
      const length = 0.06 + density * 0.12
      const paint = palette(
        { low: density, mid: audio.mid, high: audio.high, energy: audio.energy },
        this.hueShift,
        audio.energy * 0.1
      )

      const opacity = (0.12 + density * 0.2) * this.weight

      const e = document.createElement('a-entity')
      e.setAttribute(
        'geometry',
        `primitive: cylinder; radius: ${thickness}; height: ${length}; segmentsRadial: 10; segmentsHeight: 1`
      )
      e.setAttribute('material', {
        color: paint.color,
        opacity,
        shader: 'standard',
        roughness: 0.55,
        metalness: 0.1,
        emissive: paint.emissive,
        emissiveIntensity: 0.15,
        transparent: true,
        depthWrite: false
      })

      e.object3D.position.copy(drawPos)
      const quat = new THREE.Quaternion()
      quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
      e.object3D.quaternion.copy(quat)

      e.setAttribute(
        'animation__fade',
        `property: material.opacity; to: 0.02; dur: 120000; easing: easeOutQuad`
      )

      this.world.appendChild(e)
      this.addStroke(e)
    }
  }
}

class BubbleBrush extends BaseBrush {
  constructor(opts) {
    super(opts)
    this.floatPhase = smoothNoise(this.seed, this.seed + 0.7) * TAU
  }

  update(audio, time, dt, pos, dir, right, up) {
    this.elapsed += dt * 0.001
    this.updateWeight(dt)
    if (this.weight < 0.02) return

    const frequency = clamp(audio.mid * 1.15, 0, 1)
    const interval = lerp(320, 130, frequency)
    this.spawnClock += dt * (0.3 + this.weight)

    while (this.spawnClock >= interval) {
      this.spawnClock -= interval
      const t = this.elapsed
      const size = 0.04 + audio.low * 0.18
      const jitter = (0.01 + audio.high * 0.05) * this.weight

      const drift = noiseSigned(t, this.seed + 1.9) * jitter
      const driftUp = noiseSigned(t, this.seed + 2.6) * jitter
      const drawPos = pos
        .clone()
        .addScaledVector(right, drift)
        .addScaledVector(up, driftUp)

      const paint = palette(
        { low: audio.low, mid: frequency, high: audio.high, energy: audio.energy },
        this.hueShift,
        0.05
      )

      const opacity = (0.1 + audio.low * 0.18) * this.weight

      const e = document.createElement('a-entity')
      e.setAttribute(
        'geometry',
        'primitive: icosahedron; radius: 1; detail: 1'
      )
      e.setAttribute('material', {
        color: paint.color,
        opacity,
        shader: 'standard',
        roughness: 0.2,
        metalness: 0.05,
        emissive: paint.emissive,
        emissiveIntensity: 0.25,
        transparent: true,
        depthWrite: false
      })

      e.object3D.position.copy(drawPos)
      e.object3D.scale.setScalar(size)

      const floatOffset = 0.12 + audio.low * 0.2
      const floatDuration = 6500 + smoothNoise(t, this.seed + 4.1) * 2500
      e.setAttribute(
        'animation__float',
        `property: position; to: ${drawPos.x} ${drawPos.y + floatOffset} ${drawPos.z}; dir: alternate; dur: ${Math.round(floatDuration)}; easing: easeInOutSine; loop: true`
      )
      e.setAttribute(
        'animation__fade',
        `property: material.opacity; to: 0.02; dur: 130000; easing: easeOutQuad`
      )

      this.world.appendChild(e)
      this.addStroke(e)
    }
  }
}

class GlowBrush extends BaseBrush {
  update(audio, time, dt, pos, dir, right, up) {
    this.elapsed += dt * 0.001
    this.updateWeight(dt)
    if (this.weight < 0.02) return

    const rhythm = clamp(audio.mid * 1.2, 0, 1)
    const interval = lerp(240, 90, rhythm)
    this.spawnClock += dt * (0.35 + this.weight)

    while (this.spawnClock >= interval) {
      this.spawnClock -= interval
      const t = this.elapsed
      const amplitude = 0.05 + audio.mid * 0.18
      const frequency = 0.6 + audio.high * 1.8

      const wave = Math.sin(t * frequency + this.seed) * amplitude
      const waveUp = Math.cos(t * frequency * 0.8 + this.seed * 1.4) * amplitude * 0.6

      const drawPos = pos
        .clone()
        .addScaledVector(right, wave)
        .addScaledVector(up, waveUp)

      const size = 0.02 + audio.mid * 0.05
      const paint = palette(
        { low: audio.low * 0.4, mid: rhythm, high: audio.high, energy: audio.energy },
        this.hueShift + 22,
        0.15
      )

      const opacity = (0.16 + rhythm * 0.24) * this.weight

      const e = document.createElement('a-entity')
      e.setAttribute(
        'geometry',
        'primitive: sphere; radius: 1; segmentsWidth: 10; segmentsHeight: 8'
      )
      e.setAttribute('material', {
        color: paint.color,
        opacity,
        shader: 'standard',
        roughness: 0.1,
        metalness: 0.2,
        emissive: paint.emissive,
        emissiveIntensity: 0.6,
        transparent: true,
        depthWrite: false
      })

      e.object3D.position.copy(drawPos)
      e.object3D.scale.setScalar(size)

      e.setAttribute(
        'animation__fade',
        `property: material.opacity; to: 0.04; dur: 110000; easing: easeOutQuad`
      )

      this.world.appendChild(e)
      this.addStroke(e)
    }
  }
}

export const BRUSH_TYPES = {
  ink: InkBrush,
  bubbles: BubbleBrush,
  glow: GlowBrush
}

export class BrushManager {
  constructor(world) {
    this.world = world
    this.slots = []
  }

  addSlot({ name, offset, distance, type }) {
    const slot = {
      name,
      offset,
      distance,
      current: null,
      next: null,
      type: null,
      nextType: null
    }
    this.slots.push(slot)
    if (type) this.setSlotBrush(this.slots.length - 1, type)
  }

  setSlotBrush(index, type) {
    const slot = this.slots[index]
    if (!slot || slot.type === type) return

    const BrushClass = BRUSH_TYPES[type]
    if (!BrushClass) return

    const seed = (index + 1) * 3.3 + Math.random() * 4
    const hueShift = index === 0 ? -8 : index === 1 ? 0 : 18
    const brush = new BrushClass({ world: this.world, seed, hueShift })

    if (!slot.current) {
      brush.weight = 1
      brush.targetWeight = 1
      slot.current = brush
      slot.type = type
      return
    }

    brush.weight = 0
    brush.setWeight(1)
    slot.next = brush
    slot.nextType = type
    slot.current.setWeight(0)
  }

  update(audio, time, dt, camPos, forward, right, up) {
    this.slots.forEach((slot, index) => {
      const audioLift = audio.mid * 0.5 - audio.low * 0.22
      const slotDist = slot.distance + audioLift

      const drawPos = camPos
        .clone()
        .addScaledVector(forward, slotDist)
        .addScaledVector(right, slot.offset.x)
        .addScaledVector(up, slot.offset.y)

      if (slot.current) {
        slot.current.update(audio, time, dt, drawPos, forward, right, up)
        if (slot.next) {
          slot.next.update(audio, time, dt, drawPos, forward, right, up)
        }

        if (slot.current.isFadedOut() && slot.next) {
          slot.current.dispose()
          slot.current = slot.next
          slot.type = slot.nextType
          slot.next = null
          slot.nextType = null
        }
      }
    })
  }
}

export class AutoProgramManager {
  constructor(brushManager) {
    this.brushManager = brushManager
    this.enabled = true
    this.programs = [
      {
        name: 'Encre → Bulles → Lumière',
        duration: 16000,
        slots: ['ink', 'bubbles', 'glow']
      },
      {
        name: 'Minimal → Dense → Dissolution',
        duration: 18000,
        slots: ['ink', 'ink', 'glow']
      },
      {
        name: 'Respiration lente',
        duration: 20000,
        slots: ['bubbles', 'ink', 'bubbles']
      }
    ]
    this.index = 0
    this.elapsed = 0
  }

  setEnabled(enabled) {
    this.enabled = enabled
  }

  update(dt, audioEnergy = 0) {
    if (!this.enabled) return
    this.elapsed += dt

    const current = this.programs[this.index]
    const boost = audioEnergy > 0.45 ? -2500 : 0
    const duration = current.duration + boost

    if (this.elapsed >= duration) {
      this.elapsed = 0
      this.index = (this.index + 1) % this.programs.length
      const next = this.programs[this.index]
      next.slots.forEach((type, slotIndex) => {
        this.brushManager.setSlotBrush(slotIndex, type)
      })
    }
  }

  applyProgram(index = 0) {
    this.index = index % this.programs.length
    const program = this.programs[this.index]
    program.slots.forEach((type, slotIndex) => {
      this.brushManager.setSlotBrush(slotIndex, type)
    })
  }

  getCurrentName() {
    return this.programs[this.index]?.name || ''
  }
}
