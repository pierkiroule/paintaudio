import * as THREE from 'three'

export function createPaper(scene) {
  const geo = new THREE.PlaneGeometry(20, 40)

  const mat = new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: `
      void main(){
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;

      float noise(vec2 p){
        return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453);
      }

      void main(){
        vec2 uv = gl_FragCoord.xy / vec2(800.0,1600.0);
        float n1 = noise(uv*300.0);
        float n2 = noise(uv*60.0 + uTime*0.02);
        float grain = mix(n1,n2,0.4);
        float paper = 0.94 + grain*0.05;
        gl_FragColor = vec4(vec3(paper),1.0);
      }
    `
  })

  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.z = -5
  scene.add(mesh)

  return mat
}
