const clamp = (val, min, max) => Math.min(max, Math.max(min, val))
const lerp = (a, b, t) => a + (b - a) * t

export class BrushRibbon {
  constructor({
    world,
    maxControlPoints = 5,
    sampleCount = 40,
    baseWidth = 0.06,
    baseOpacity = 0.08
  }) {
    this.world = world
    this.maxControlPoints = clamp(maxControlPoints, 4, 6)
    this.sampleCount = sampleCount
    this.baseWidth = baseWidth
    this.baseOpacity = baseOpacity
    this.width = baseWidth
    this.opacity = baseOpacity
    this.controlPoints = []
    this.curve = new THREE.CatmullRomCurve3(this.controlPoints)
    this.geometry = new THREE.BufferGeometry()
    this.material = new THREE.MeshStandardMaterial({
      color: '#f4f0e8',
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.05
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.world.object3D.add(this.mesh)

    this._up = new THREE.Vector3(0, 1, 0)
    this._altUp = new THREE.Vector3(1, 0, 0)
    this._tangent = new THREE.Vector3()
    this._lateral = new THREE.Vector3()
    this._left = new THREE.Vector3()
    this._right = new THREE.Vector3()
    this._positions = null
    this._uvs = null
    this._indices = null
    this._initGeometry()
  }

  _initGeometry() {
    const vertexCount = (this.sampleCount + 1) * 2
    this._positions = new Float32Array(vertexCount * 3)
    this._uvs = new Float32Array(vertexCount * 2)
    this._indices = new Uint32Array(this.sampleCount * 6)

    for (let i = 0; i <= this.sampleCount; i += 1) {
      const t = i / this.sampleCount
      const row = i * 2
      this._uvs[row * 2] = t
      this._uvs[row * 2 + 1] = 0
      this._uvs[row * 2 + 2] = t
      this._uvs[row * 2 + 3] = 1

      if (i < this.sampleCount) {
        const a = row
        const b = row + 1
        const c = row + 2
        const d = row + 3
        const idx = i * 6
        this._indices[idx] = a
        this._indices[idx + 1] = b
        this._indices[idx + 2] = c
        this._indices[idx + 3] = b
        this._indices[idx + 4] = d
        this._indices[idx + 5] = c
      }
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(this._uvs, 2))
    this.geometry.setIndex(new THREE.BufferAttribute(this._indices, 1))
  }

  _ensureControlPoints(drawPos) {
    if (this.controlPoints.length > 0) return
    for (let i = 0; i < this.maxControlPoints; i += 1) {
      const offset = new THREE.Vector3(0, 0, -0.001 * i)
      this.controlPoints.push(drawPos.clone().add(offset))
    }
  }

  _updateControlPoints(drawPos) {
    const lastIndex = this.controlPoints.length - 1
    const lastPoint = this.controlPoints[lastIndex]
    lastPoint.lerp(drawPos, 0.04)

    for (let i = lastIndex - 1; i >= 0; i -= 1) {
      this.controlPoints[i].lerp(this.controlPoints[i + 1], 0.08)
    }
  }

  update(drawPos, audio = { low: 0, mid: 0, high: 0 }, time = 0) {
    this._ensureControlPoints(drawPos)
    this._updateControlPoints(drawPos)

    this.width = lerp(this.width, this.baseWidth + audio.mid * 0.3, 0.05)
    this.opacity = lerp(this.opacity, this.baseOpacity + audio.low * 0.1, 0.03)
    this.material.opacity = clamp(this.opacity, 0.05, 0.12)

    const pts = this.curve.getPoints(this.sampleCount)
    const up = this._up
    const altUp = this._altUp
    const lateral = this._lateral
    const tangent = this._tangent

    for (let i = 0; i < pts.length; i += 1) {
      const t = i / (pts.length - 1)
      this.curve.getTangentAt(t, tangent)
      if (tangent.lengthSq() < 1e-6) {
        tangent.set(0, 0, 1)
      }

      const axis = Math.abs(tangent.dot(up)) > 0.9 ? altUp : up
      lateral.crossVectors(tangent, axis)
      if (lateral.lengthSq() < 1e-6) {
        lateral.set(1, 0, 0)
      } else {
        lateral.normalize()
      }

      const wobble = Math.sin(time * 0.0012 + i * 0.35) * audio.high * 0.03
      const halfWidth = this.width * 0.5 + wobble

      const left = this._left.copy(pts[i]).addScaledVector(lateral, halfWidth)
      const right = this._right.copy(pts[i]).addScaledVector(lateral, -halfWidth)

      const row = i * 2
      const posIndex = row * 3
      this._positions[posIndex] = left.x
      this._positions[posIndex + 1] = left.y
      this._positions[posIndex + 2] = left.z
      this._positions[posIndex + 3] = right.x
      this._positions[posIndex + 4] = right.y
      this._positions[posIndex + 5] = right.z
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.computeVertexNormals()
  }

  dispose() {
    this.world.object3D.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
  }
}
