const TAU = Math.PI * 2

const clamp = (val, min, max) => Math.min(max, Math.max(min, val))
const lerp = (a, b, t) => a + (b - a) * t
const toVec3 = (v) => `${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`
const deg = (radians) => (radians * 180) / Math.PI

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
  const saturation = 45 + energy * 55
  const lightness = 18 + energy * 36
  const colorObj = new THREE.Color().setHSL(hue / 360, saturation / 100, lightness / 100)
  const emissiveObj = new THREE.Color().setHSL(
    ((hue + 18) % 360) / 360,
    clamp((saturation + 18) / 100, 0, 1),
    clamp((lightness + 12) / 100, 0, 1)
  )
  const color = `#${colorObj.getHexString()}`
  const emissive = `#${emissiveObj.getHexString()}`
  const opacity = 0.3 + energy * 0.4
  return { color, emissive, opacity }
}

function applyVibration(entity, basePos, intensity, seed) {
  const amp = clamp(intensity, 0.002, 0.05)
  const offset = new THREE.Vector3(
    noiseSigned(seed * 1.3, seed + 1.1) * amp,
    noiseSigned(seed * 1.7, seed + 2.4) * amp,
    noiseSigned(seed * 2.1, seed + 3.6) * amp
  )
  const to = basePos.clone().add(offset)
  const duration = 700 + smoothNoise(seed * 0.3, seed + 4.8) * 1100
  entity.setAttribute(
    'animation__vibrate',
    `property: position; to: ${toVec3(to)}; dir: alternate; dur: ${Math.round(duration)}; easing: easeInOutSine; loop: true`
  )

  const rot = {
    x: deg(entity.object3D.rotation.x) + noiseSigned(seed + 5.1, seed + 6.7) * 4.5,
    y: deg(entity.object3D.rotation.y) + noiseSigned(seed + 7.3, seed + 8.9) * 5,
    z: deg(entity.object3D.rotation.z) + noiseSigned(seed + 9.2, seed + 10.1) * 4
  }
  entity.setAttribute(
    'animation__twist',
    `property: rotation; to: ${rot.x.toFixed(2)} ${rot.y.toFixed(2)} ${rot.z.toFixed(2)}; dir: alternate; dur: ${Math.round(duration * 1.3)}; easing: easeInOutSine; loop: true`
  )
}

function applyPulse(entity, baseScale, amount, seed) {
  const pulse = clamp(amount, 0.02, 0.4)
  const target = baseScale.clone().multiplyScalar(1 + pulse)
  const duration = 1100 + smoothNoise(seed * 0.2, seed + 4.2) * 1600
  entity.setAttribute(
    'animation__pulse',
    `property: scale; to: ${toVec3(target)}; dir: alternate; dur: ${Math.round(duration)}; easing: easeInOutSine; loop: true`
  )
}

class BaseBrush {
  constructor({ world, maxStrokes = 240, seed = 1, hueShift = 0 }) {
    this.world = world
    this.maxStrokes = maxStrokes
    this.strokes = []
    this.seed = seed
    this.hueShift = hueShift
    this.spawnAcc = 0
    this.spawnRate = 0
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

  advanceSpawn(dt, targetRate, response = 0.004) {
    const blend = 1 - Math.exp(-dt * response)
    this.spawnRate = lerp(this.spawnRate, targetRate, blend)
    this.spawnAcc += (dt * 0.001) * this.spawnRate
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
  constructor(opts) {
    super(opts)
    this.lastPos = null
    this.splashAcc = 0
  }

  spawnSplash(audio, drawPos, dir, right, up) {
    const t = this.elapsed
    const splash = document.createElement('a-entity')
    const height = 0.06 + audio.high * 0.08
    const radiusBottom = 0.012 + audio.high * 0.016
    const radiusTop = radiusBottom * 0.2
    splash.setAttribute(
      'geometry',
      `primitive: cone; radiusBottom: ${radiusBottom}; radiusTop: ${radiusTop}; height: ${height}; segmentsRadial: 10`
    )
    splash.setAttribute('material', {
      color: '#0b0b0b',
      opacity: clamp(0.5 + audio.high * 0.35, 0.45, 0.85),
      shader: 'standard',
      roughness: 0.85,
      metalness: 0.05,
      emissive: '#000000',
      emissiveIntensity: 0,
      transparent: true,
      depthWrite: false
    })

    const splashOffset = new THREE.Vector3()
      .addScaledVector(right, noiseSigned(t, this.seed + 11.1) * 0.08)
      .addScaledVector(up, noiseSigned(t, this.seed + 12.7) * 0.08)
      .addScaledVector(dir, 0.1 + audio.high * 0.12)
    const splashPos = drawPos.clone().add(splashOffset)
    splash.object3D.position.copy(splashPos)

    const dripOffset = splashPos.clone().addScaledVector(up, -0.4 - audio.high * 0.6)
    splash.setAttribute(
      'animation__drip',
      `property: position; to: ${toVec3(dripOffset)}; dur: 12000; easing: easeInQuad`
    )
    splash.setAttribute(
      'animation__taper',
      `property: scale; to: 0.15 1.6 0.15; dur: 16000; easing: easeOutQuad`
    )
    splash.setAttribute(
      'animation__fade',
      `property: material.opacity; to: 0.0; dur: 22000; easing: easeOutQuad`
    )

    applyVibration(splash, splashPos, 0.02 + audio.high * 0.04, this.seed + t)

    this.world.appendChild(splash)
    this.addStroke(splash)
  }

  update(audio, time, dt, pos, dir, right, up) {
    this.elapsed += dt * 0.001
    this.updateWeight(dt)
    if (this.weight < 0.02) return

    const density = clamp(audio.low * 1.25, 0, 1)
    const minRate = 1000 / 170
    const maxRate = 1000 / 55
    const targetRate = lerp(minRate, maxRate, density) * (0.55 + this.weight)
    this.advanceSpawn(dt, targetRate)

    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1
      const t = this.elapsed
      const lineWiggle = noiseSigned(t, this.seed + 0.5) * audio.high
      const offset = new THREE.Vector3()
      offset
        .addScaledVector(right, lineWiggle * 0.045)
        .addScaledVector(up, noiseSigned(t, this.seed + 1.4) * 0.035)

      const jitterAmt = 0.015 + audio.high * 0.06
      offset.addScaledVector(right, noiseSigned(t, this.seed + 2.2) * jitterAmt)
      offset.addScaledVector(up, noiseSigned(t, this.seed + 3.1) * jitterAmt)

      const drawPos = pos.clone().add(offset)
      if (!this.lastPos) {
        this.lastPos = drawPos.clone()
      }

      const thickness = 0.008 + audio.mid * 0.04
      const length = 0.09 + density * 0.18
      const paint = palette(
        { low: density, mid: audio.mid, high: audio.high, energy: audio.energy },
        this.hueShift,
        audio.energy * 0.15
      )

      const opacity = clamp(
        0.32 + density * 0.32 + audio.energy * 0.25,
        0.3,
        0.8
      ) * this.weight

      const segmentStart = this.lastPos.clone()
      const segmentEnd = drawPos.clone()
      const segmentDir = segmentEnd.clone().sub(segmentStart)
      const segmentDist = segmentDir.length()
      if (segmentDist > 0.004) {
        const segmentCount = Math.max(1, Math.ceil(segmentDist / (length * 0.75)))
        const step = segmentDir.clone().multiplyScalar(1 / segmentCount)
        for (let i = 0; i < segmentCount; i += 1) {
          const a = segmentStart.clone().addScaledVector(step, i)
          const b = segmentStart.clone().addScaledVector(step, i + 1)
          const mid = a.clone().add(b).multiplyScalar(0.5)
          const e = document.createElement('a-entity')
          const pieceLen = Math.max(length * 0.65, a.distanceTo(b) + thickness * 0.8)
          e.setAttribute(
            'geometry',
            `primitive: cylinder; radius: ${thickness}; height: ${pieceLen}; segmentsRadial: 12; segmentsHeight: 1`
          )
          e.setAttribute('material', {
            color: paint.color,
            opacity,
            shader: 'standard',
            roughness: 0.55,
            metalness: 0.1,
            emissive: paint.emissive,
            emissiveIntensity: 0.3,
            transparent: true,
            depthWrite: false
          })

          e.object3D.position.copy(mid)
          const quat = new THREE.Quaternion()
          quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
          e.object3D.quaternion.copy(quat)

          if (audio.energy > 0.15 || Math.random() < 0.4) {
            applyVibration(e, mid, 0.01 + audio.high * 0.03, this.seed + t + i)
          }

          e.setAttribute(
            'animation__fade',
            `property: material.opacity; to: 0.02; dur: 120000; easing: easeOutQuad`
          )

          this.world.appendChild(e)
          this.addStroke(e)
        }
      }
      this.lastPos.copy(drawPos)

      const splashGate = clamp((audio.high - 0.55) * 2.2 + audio.energy * 0.6, 0, 1)
      this.splashAcc += splashGate * (dt * 0.001) * 2.1
      if (this.splashAcc >= 1) {
        this.splashAcc -= 1
        const splashCount = 1 + Math.floor(smoothNoise(t, this.seed + 13.4) * 2)
        for (let i = 0; i < splashCount; i += 1) {
          this.spawnSplash(audio, drawPos, dir, right, up)
        }
      }
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
    const minRate = 1000 / 280
    const maxRate = 1000 / 110
    const targetRate = lerp(minRate, maxRate, frequency) * (0.45 + this.weight)
    this.advanceSpawn(dt, targetRate)

    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1
      const t = this.elapsed
      const size = 0.05 + audio.low * 0.22
      const jitter = (0.015 + audio.high * 0.08) * this.weight

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

      const opacity = clamp(
        0.34 + audio.low * 0.28 + audio.energy * 0.22,
        0.3,
        0.8
      ) * this.weight

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
        emissiveIntensity: 0.4,
        transparent: true,
        depthWrite: false
      })

      e.object3D.position.copy(drawPos)
      e.object3D.scale.setScalar(size)

      if (audio.energy > 0.1 || Math.random() < 0.35) {
        applyVibration(e, drawPos, 0.008 + audio.high * 0.03, this.seed + t)
      }
      applyPulse(e, new THREE.Vector3(size, size, size), 0.12 + audio.mid * 0.35, this.seed + 0.8)

      const floatOffset = 0.18 + audio.low * 0.32
      const floatDuration = 5200 + smoothNoise(t, this.seed + 4.1) * 2100
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
    const minRate = 1000 / 210
    const maxRate = 1000 / 80
    const targetRate = lerp(minRate, maxRate, rhythm) * (0.5 + this.weight)
    this.advanceSpawn(dt, targetRate)

    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1
      const t = this.elapsed
      const amplitude = 0.08 + audio.mid * 0.26
      const frequency = 0.9 + audio.high * 2.6

      const wave = Math.sin(t * frequency + this.seed) * amplitude
      const waveUp = Math.cos(t * frequency * 0.8 + this.seed * 1.4) * amplitude * 0.6

      const drawPos = pos
        .clone()
        .addScaledVector(right, wave)
        .addScaledVector(up, waveUp)

      const size = 0.03 + audio.mid * 0.07
      const paint = palette(
        { low: audio.low * 0.4, mid: rhythm, high: audio.high, energy: audio.energy },
        this.hueShift + 22,
        0.15
      )

      const opacity = clamp(
        0.38 + rhythm * 0.28 + audio.high * 0.18,
        0.3,
        0.8
      ) * this.weight

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
        emissiveIntensity: 0.85,
        transparent: true,
        depthWrite: false
      })

      e.object3D.position.copy(drawPos)
      e.object3D.scale.setScalar(size)

      if (audio.energy > 0.1 || Math.random() < 0.4) {
        applyVibration(e, drawPos, 0.01 + audio.high * 0.03, this.seed + t)
      }
      applyPulse(e, new THREE.Vector3(size, size, size), 0.18 + audio.energy * 0.5, this.seed + 1.6)

      e.setAttribute(
        'animation__fade',
        `property: material.opacity; to: 0.04; dur: 110000; easing: easeOutQuad`
      )

      this.world.appendChild(e)
      this.addStroke(e)
    }
  }
}

class TubeBrush extends BaseBrush {
  constructor(opts) {
    super(opts)
    this.lastPos = null
    this.bloomAcc = 0
  }

  spawnTubeSegment(start, end, paint, radius, opacity, audio, seed) {
    const dir = end.clone().sub(start)
    const distance = dir.length()
    if (distance < 0.004) return

    const mid = start.clone().add(end).multiplyScalar(0.5)
    const e = document.createElement('a-entity')
    const pieceLen = distance + radius * 1.2
    e.setAttribute(
      'geometry',
      `primitive: cylinder; radius: ${radius}; height: ${pieceLen}; segmentsRadial: 14; segmentsHeight: 1`
    )
    e.setAttribute('material', {
      color: paint.color,
      opacity,
      shader: 'standard',
      roughness: 0.28,
      metalness: 0.18,
      emissive: paint.emissive,
      emissiveIntensity: 0.65,
      transparent: true,
      depthWrite: false
    })

    e.object3D.position.copy(mid)
    const quat = new THREE.Quaternion()
    quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    e.object3D.quaternion.copy(quat)

    if (audio && (audio.energy > 0.2 || Math.random() < 0.2)) {
      applyVibration(e, mid, 0.006 + audio.high * 0.02, seed)
    }

    e.setAttribute(
      'animation__fade',
      `property: material.opacity; to: 0.02; dur: 130000; easing: easeOutQuad`
    )

    this.world.appendChild(e)
    this.addStroke(e)
  }

  update(audio, time, dt, pos, dir, right, up) {
    this.elapsed += dt * 0.001
    this.updateWeight(dt)
    if (this.weight < 0.02) return

    const intensity = clamp(audio.energy * 1.1 + audio.mid * 0.35, 0, 1)
    const minRate = 1000 / 190
    const maxRate = 1000 / 55
    const targetRate = lerp(minRate, maxRate, intensity) * (0.45 + this.weight)
    this.advanceSpawn(dt, targetRate)

    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1
      const t = this.elapsed
      const jitter = 0.02 + audio.high * 0.08
      const drawPos = pos
        .clone()
        .addScaledVector(right, noiseSigned(t, this.seed + 2.2) * jitter)
        .addScaledVector(up, noiseSigned(t, this.seed + 3.5) * jitter)

      if (!this.lastPos) {
        this.lastPos = drawPos.clone()
      }

      const paint = palette(
        { low: audio.low, mid: audio.mid, high: audio.high, energy: audio.energy },
        this.hueShift + 8,
        0.22
      )
      const opacity = clamp(0.28 + intensity * 0.5, 0.24, 0.85) * this.weight
      const radius = 0.012 + audio.low * 0.04

      const segmentDir = drawPos.clone().sub(this.lastPos)
      const distance = segmentDir.length()
      if (distance > 0.01) {
        const segmentCount = Math.max(1, Math.ceil(distance / 0.14))
        const step = segmentDir.clone().multiplyScalar(1 / segmentCount)
        for (let i = 0; i < segmentCount; i += 1) {
          const a = this.lastPos.clone().addScaledVector(step, i)
          const b = this.lastPos.clone().addScaledVector(step, i + 1)
          this.spawnTubeSegment(a, b, paint, radius, opacity, audio, this.seed + t + i)
        }
      }

      const bloomGate = smoothNoise(t * 0.45, this.seed + 5.7) + intensity * 0.55
      const bloomStrength = clamp(bloomGate, 0, 1)
      this.bloomAcc += bloomStrength * (dt * 0.001) * 1.4
      while (this.bloomAcc >= 1) {
        this.bloomAcc -= 1
        const bloomCount = 3 + Math.floor(smoothNoise(t, this.seed + 9.1) * 3)
        for (let i = 0; i < bloomCount; i += 1) {
          const angle = (i / bloomCount) * TAU
          const spread = 0.08 + audio.high * 0.16
          const offset = new THREE.Vector3()
            .addScaledVector(right, Math.cos(angle) * spread)
            .addScaledVector(up, Math.sin(angle) * spread)
          const bloomStart = drawPos.clone().add(offset)
          const bloomEnd = bloomStart.clone().addScaledVector(dir, 0.16 + audio.mid * 0.25)
          this.spawnTubeSegment(
            bloomStart,
            bloomEnd,
            paint,
            radius * 1.4,
            opacity,
            audio,
            this.seed + t + i * 2.1
          )
        }
      }

      this.lastPos.copy(drawPos)
    }
  }
}

export const BRUSH_TYPES = {
  ink: InkBrush,
  bubbles: BubbleBrush,
  glow: GlowBrush,
  tubes: TubeBrush
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
      const audioLift = audio.mid * 0.75 - audio.low * 0.35 + audio.energy * 0.25
      const slotDist = slot.distance + audioLift
      const timeSec = time * 0.001
      const symmetrySignal = clamp(
        (Math.sin(timeSec * 0.35 + index * 1.2) + 1) * 0.4 + audio.high * 0.55 + audio.energy * 0.35,
        0,
        1
      )
      const symmetryCount = symmetrySignal > 0.65 ? 3 + Math.floor(symmetrySignal * 3) : 1
      for (let i = 0; i < symmetryCount; i += 1) {
        const angle = (i / symmetryCount) * TAU
        const rot = new THREE.Quaternion().setFromAxisAngle(forward, angle)
        const radialRight = right.clone().applyQuaternion(rot)
        const radialUp = up.clone().applyQuaternion(rot)
        const drawPos = camPos
          .clone()
          .addScaledVector(forward, slotDist)
          .addScaledVector(radialRight, slot.offset.x)
          .addScaledVector(radialUp, slot.offset.y)

        if (slot.current) {
          slot.current.update(audio, time, dt, drawPos, forward, radialRight, radialUp)
          if (slot.next) {
            slot.next.update(audio, time, dt, drawPos, forward, radialRight, radialUp)
          }

          if (slot.current.isFadedOut() && slot.next) {
            slot.current.dispose()
            slot.current = slot.next
            slot.type = slot.nextType
            slot.next = null
            slot.nextType = null
          }
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
      },
      {
        name: 'Tube solaire',
        duration: 17000,
        slots: ['tubes', 'glow', 'tubes']
      },
      {
        name: 'Filaments organiques',
        duration: 19000,
        slots: ['ink', 'tubes', 'glow']
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
    const energyLift = clamp(audioEnergy * 0.9, 0, 1)
    const duration = current.duration + lerp(0, -2500, energyLift)

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
