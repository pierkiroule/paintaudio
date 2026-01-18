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
    this._color = new THREE.Color()
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
  }
}
