const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const lerp = (a, b, t) => a + (b - a) * t

export class BrushRibbon {
  constructor({
    world,
    maxControlPoints = 5,
    sampleCount = 40,
    baseWidth = 0.28,
    baseOpacity = 0.5,
    freezeInterval = 80,   // plus petit = plus continu
    maxStrokes = 260
  }) {
    this.world = world
    this.maxControlPoints = clamp(maxControlPoints, 4, 6)
    this.sampleCount = sampleCount

    this.baseWidth = baseWidth
    this.baseOpacity = baseOpacity
    this.width = baseWidth
    this.opacity = baseOpacity

    // ---- accumulation continue
    this.freezeInterval = freezeInterval
    this.maxStrokes = maxStrokes
    this.strokes = []
    this.freezeAcc = 0

    // ---- courbe (outil)
    this.controlPoints = []
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints)
    this.curve.curveType = 'catmullrom'
    this.curve.tension = 0.6

    // ---- géométrie active
    this.geometry = new THREE.BufferGeometry()
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: this.opacity,
      emissive: new THREE.Color(0x111111),
      emissiveIntensity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 0.65,
      metalness: 0.0
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.world.object3D.add(this.mesh)

    this._initGeometry()

    // buffers temporaires
    this._up = new THREE.Vector3(0, 1, 0)
    this._altUp = new THREE.Vector3(1, 0, 0)
    this._tangent = new THREE.Vector3()
    this._lateral = new THREE.Vector3()
    this._tmp = new THREE.Vector3()
    this._tmpMine = new THREE.Vector3()
    this._color = new THREE.Color()

    // mines & particules d'encre
    this.mineInterval = 420
    this.mineAcc = 0
    this.mineDelay = 2000
    this.mines = []
    this.particles = []
    this.mineGeometry = new THREE.SphereGeometry(0.035, 12, 12)
    this.mineMaterial = new THREE.MeshStandardMaterial({
      color: 0x050505,
      roughness: 0.9,
      metalness: 0.0
    })
  }

  /* ---------------- GEOMETRY ---------------- */

  _initGeometry() {
    const vCount = (this.sampleCount + 1) * 2
    this._positions = new Float32Array(vCount * 3)
    this._uvs = new Float32Array(vCount * 2)
    this._indices = new Uint16Array(this.sampleCount * 6)
    this._colors = new Float32Array(vCount * 3)

    for (let i = 0; i <= this.sampleCount; i++) {
      const v = i / this.sampleCount
      const row = i * 2

      // UV : U largeur / V longueur
      this._uvs[row * 2] = 0
      this._uvs[row * 2 + 1] = v
      this._uvs[row * 2 + 2] = 1
      this._uvs[row * 2 + 3] = v

      if (i < this.sampleCount) {
        const a = row
        const b = row + 1
        const c = row + 2
        const d = row + 3
        const id = i * 6
        this._indices[id] = a
        this._indices[id + 1] = b
        this._indices[id + 2] = c
        this._indices[id + 3] = b
        this._indices[id + 4] = d
        this._indices[id + 5] = c
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this._uvs, 2))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3))
    this.geometry.setIndex(new THREE.BufferAttribute(this._indices, 1))
  }

  /* ---------------- COURBE ---------------- */

  _ensureControlPoints(drawPos) {
    if (this.controlPoints.length > 0) return
    for (let i = 0; i < this.maxControlPoints; i++) {
      this.controlPoints.push(drawPos.clone())
    }
  }

  _updateControlPoints(drawPos) {
    const last = this.controlPoints.length - 1
    this.controlPoints[last].lerp(drawPos, 0.12)
    for (let i = last - 1; i >= 0; i--) {
      this.controlPoints[i].lerp(this.controlPoints[i + 1], 0.2)
    }
  }

  /* ---------------- TRACE CONTINUE ---------------- */

  _freezeContinuous(dt) {
    const rate = 1 / this.freezeInterval
    this.freezeAcc += dt * rate

    while (this.freezeAcc >= 1) {
      this.freezeAcc -= 1
      this._freezeOnce()
    }
  }

  _freezeOnce() {
    const geom = this.geometry.clone()
    const mat = this.material.clone()

    mat.opacity *= 0.78
    mat.emissiveIntensity *= 0.7
    mat.depthWrite = false

    const mesh = new THREE.Mesh(geom, mat)
    mesh.frustumCulled = false

    this.world.object3D.add(mesh)
    this.strokes.push(mesh)

    if (this.strokes.length > this.maxStrokes) {
      const old = this.strokes.shift()
      this.world.object3D.remove(old)
      old.geometry.dispose()
      old.material.dispose()
    }
  }

  _spawnMine(position, time) {
    const mesh = new THREE.Mesh(this.mineGeometry, this.mineMaterial)
    mesh.position.copy(position)
    mesh.frustumCulled = false
    this.world.object3D.add(mesh)
    this.mines.push({ mesh, born: time })
  }

  _explodeMine(mine, time) {
    const count = 70
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    const spread = 0.12
    const speed = 0.55
    const origin = mine.mesh.position

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * spread
      const yBias = Math.random() * 0.12

      positions[i3] = origin.x + Math.cos(angle) * radius
      positions[i3 + 1] = origin.y + (Math.random() - 0.5) * 0.04
      positions[i3 + 2] = origin.z + Math.sin(angle) * radius

      velocities[i3] = Math.cos(angle) * (speed + Math.random() * 0.4)
      velocities[i3 + 1] = yBias
      velocities[i3 + 2] = Math.sin(angle) * (speed + Math.random() * 0.4)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: 0x050505,
      size: 0.05,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    this.world.object3D.add(points)
    this.particles.push({
      points,
      positions,
      velocities,
      born: time,
      ttl: 1600
    })
  }

  _updateMines(time, dt, energy) {
    const minInterval = Math.max(140, this.mineInterval * (1.1 - energy * 0.6))
    this.mineAcc += dt
    while (this.mineAcc >= minInterval) {
      this.mineAcc -= minInterval
      if (energy < 0.18) continue
      const jitter = 0.22 + energy * 0.25
      this._tmpMine.set(
        (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * jitter * 0.6,
        (Math.random() - 0.5) * jitter
      )
      const pos = this._tmp.clone().add(this._tmpMine)
      this._spawnMine(pos, time)
    }

    for (let i = this.mines.length - 1; i >= 0; i--) {
      const mine = this.mines[i]
      if (time - mine.born >= this.mineDelay) {
        this.world.object3D.remove(mine.mesh)
        this._explodeMine(mine, time)
        this.mines.splice(i, 1)
      }
    }
  }

  _updateParticles(time, dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const system = this.particles[i]
      const age = time - system.born
      const life = age / system.ttl
      const drag = 0.9
      const count = system.positions.length / 3
      const decay = 1 - life

      for (let p = 0; p < count; p++) {
        const i3 = p * 3
        system.velocities[i3] *= drag
        system.velocities[i3 + 1] *= drag
        system.velocities[i3 + 2] *= drag

        system.positions[i3] += system.velocities[i3] * dt * 0.001
        system.positions[i3 + 1] += system.velocities[i3 + 1] * dt * 0.001
        system.positions[i3 + 2] += system.velocities[i3 + 2] * dt * 0.001
      }

      system.points.material.opacity = Math.max(0, decay * 0.9)
      system.points.material.size = 0.05 + (1 - decay) * 0.07
      system.points.geometry.attributes.position.needsUpdate = true

      if (age >= system.ttl) {
        this.world.object3D.remove(system.points)
        system.points.geometry.dispose()
        system.points.material.dispose()
        this.particles.splice(i, 1)
      }
    }
  }

  /* ---------------- UPDATE ---------------- */

  update(drawPos, audio = { low: 0, mid: 0, high: 0 }, time = 0, dt = 16) {
    if (!drawPos || !Number.isFinite(drawPos.x)) return

    this._ensureControlPoints(drawPos)
    this._updateControlPoints(drawPos)

    const energy = clamp(
      audio.energy ?? (audio.low * 0.4 + audio.mid * 0.35 + audio.high * 0.25),
      0,
      1
    )

    // modulation lente + pulsation
    const widthTarget =
      this.baseWidth +
      audio.mid * 0.32 +
      audio.low * 0.16 +
      Math.sin(time * 0.0022) * 0.03 * (0.3 + audio.high)
    this.width = lerp(this.width, widthTarget, 0.08)
    this.opacity = lerp(this.opacity, this.baseOpacity + audio.low * 0.12, 0.04)
    this.material.opacity = clamp(this.opacity, 0.02, 0.1)
    this.material.emissive.setHSL(
      (0.58 + audio.high * 0.22 + Math.sin(time * 0.00025) * 0.06) % 1,
      0.65,
      0.5
    )
    this.material.emissiveIntensity = clamp(0.4 + energy * 1.6 + audio.high, 0.2, 2.2)

    const pts = this.curve.getPoints(this.sampleCount)
    this._tmp.copy(drawPos)
    this._updateMines(time, dt, energy)
    this._updateParticles(time, dt)

    for (let i = 0; i < pts.length; i++) {
      const t = i / (pts.length - 1)
      const profile = Math.sin(Math.PI * t)

      this.curve.getTangentAt(t, this._tangent)
      const axis =
        Math.abs(this._tangent.dot(this._up)) > 0.9 ? this._altUp : this._up

      this._lateral.crossVectors(this._tangent, axis).normalize()

      const wobble =
        Math.sin(time * 0.001 + i * 0.3) * audio.high * 0.025

      const half = this.width * 0.5 * profile + wobble

      const left = this._tmp.copy(pts[i]).addScaledVector(this._lateral, half)
      const right = pts[i].clone().addScaledVector(this._lateral, -half)

      const idx = i * 6
      this._positions[idx] = left.x
      this._positions[idx + 1] = left.y
      this._positions[idx + 2] = left.z
      this._positions[idx + 3] = right.x
      this._positions[idx + 4] = right.y
      this._positions[idx + 5] = right.z

      const hue =
        (0.55 +
          audio.high * 0.3 +
          t * 0.25 +
          Math.sin(time * 0.0006 + t * 6) * 0.08) %
        1
      const saturation = clamp(0.35 + audio.mid * 0.6, 0.2, 1)
      const lightness = clamp(0.28 + profile * 0.4 + energy * 0.22, 0.15, 0.85)
      this._color.setHSL(hue, saturation, lightness)
      const cidx = i * 6
      this._colors[cidx] = this._color.r
      this._colors[cidx + 1] = this._color.g
      this._colors[cidx + 2] = this._color.b
      this._colors[cidx + 3] = this._color.r
      this._colors[cidx + 4] = this._color.g
      this._colors[cidx + 5] = this._color.b
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
    this.geometry.computeVertexNormals()

    // accumulation continue (clé)
    this._freezeContinuous(dt)
  }

  dispose() {
    this.world.object3D.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
    this.strokes.forEach(m => {
      this.world.object3D.remove(m)
      m.geometry.dispose()
      m.material.dispose()
    })
    this.strokes.length = 0

    this.mines.forEach(mine => {
      this.world.object3D.remove(mine.mesh)
    })
    this.mines.length = 0

    this.particles.forEach(system => {
      this.world.object3D.remove(system.points)
      system.points.geometry.dispose()
      system.points.material.dispose()
    })
    this.particles.length = 0
    this.mineGeometry.dispose()
    this.mineMaterial.dispose()
  }
}
