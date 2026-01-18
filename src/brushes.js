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
    this.texture = this._createWatercolorTexture()
    this.material = new THREE.MeshStandardMaterial({
      color: '#1d1d1d',
      vertexColors: true,
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      map: this.texture,
      roughness: 0.65,
      metalness: 0.02
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
    this._colors = null
    this._indices = null
    this._baseColor = new THREE.Color()
    this._tmpColor = new THREE.Color()
    this._initGeometry()
  }

  _createWatercolorTexture() {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 16
    const ctx = canvas.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0.2)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.9)')
    grad.addColorStop(1, 'rgba(255,255,255,0.2)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < 220; i += 1) {
      const x = Math.floor(Math.random() * canvas.width)
      const y = Math.floor(Math.random() * canvas.height)
      const alpha = 0.08 + Math.random() * 0.25
      const size = 1 + Math.random() * 3
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`
      ctx.fillRect(x, y, size, size)
    }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.repeat.set(2, 1)
    texture.needsUpdate = true
    return texture
  }

  _initGeometry() {
    const vertexCount = (this.sampleCount + 1) * 2
    this._positions = new Float32Array(vertexCount * 3)
    this._uvs = new Float32Array(vertexCount * 2)
    this._colors = new Float32Array(vertexCount * 3)
    this._indices = new Uint16Array(this.sampleCount * 6)

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
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this._colors, 3))
    this.geometry.setIndex(new THREE.BufferAttribute(this._indices, 1))
  }

  _ensureControlPoints(drawPos) {
    if (this.controlPoints.length > 0) return
    for (let i = 0; i < this.maxControlPoints; i += 1) {
      const offset = new THREE.Vector3(0, 0, -0.12 * i)
      this.controlPoints.push(drawPos.clone().add(offset))
    }
  }

  _updateControlPoints(drawPos) {
    const lastIndex = this.controlPoints.length - 1
    const lastPoint = this.controlPoints[lastIndex]
    lastPoint.lerp(drawPos, 0.04)

    for (let i = lastIndex - 1; i >= 0; i -= 1) {
      const lag = 0.012 + (lastIndex - i) * 0.015
      this.controlPoints[i].lerp(this.controlPoints[i + 1], lag)
    }
  }

  update(drawPos, audio = { low: 0, mid: 0, high: 0 }, time = 0) {
    this._ensureControlPoints(drawPos)
    this._updateControlPoints(drawPos)

    this.width = lerp(this.width, this.baseWidth + audio.mid * 0.3, 0.05)
    this.opacity = lerp(this.opacity, this.baseOpacity + audio.low * 0.1, 0.03)
    this.material.opacity = clamp(this.opacity, 0.06, 0.12)
    const hue = ((time * 0.01) + audio.mid * 0.55 + audio.high * 0.2) % 1
    const saturation = clamp(0.55 + audio.energy * 0.35, 0.4, 0.95)
    const lightness = clamp(0.45 + audio.low * 0.2, 0.25, 0.75)
    this._baseColor.setHSL(hue, saturation, lightness)
    this.material.color.copy(this._baseColor)

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

      const fade = 1 - t * 0.85
      this._tmpColor.copy(this._baseColor).multiplyScalar(fade)
      this._colors[posIndex] = this._tmpColor.r
      this._colors[posIndex + 1] = this._tmpColor.g
      this._colors[posIndex + 2] = this._tmpColor.b
      this._colors[posIndex + 3] = this._tmpColor.r
      this._colors[posIndex + 4] = this._tmpColor.g
      this._colors[posIndex + 5] = this._tmpColor.b
    }

    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
    this.geometry.computeVertexNormals()
    this.geometry.computeBoundingSphere()
  }

  dispose() {
    this.world.object3D.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
    this.texture?.dispose()
  }
}
