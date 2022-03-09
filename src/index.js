import * as THREE from 'three'
import debounce from 'lodash.debounce'

import { GLTFLoader } from '../three-examples/loaders/GLTFLoader'
import { EffectComposer } from '../three-examples/postprocessing/EffectComposer'
import { RenderPass } from '../three-examples/postprocessing/RenderPass'
import { ShaderPass } from '../three-examples/postprocessing/ShaderPass'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import AdditiveShader from './shaders/Additive'
import ASCIIShader from './shaders/ASCII'
import RippleShader from './shaders/Ripple'
import ScanShader from './shaders/Scan'
import VertexLitParticle from './shaders/VertexLitParticle'
import VolumetricLightScattering from './shaders/VolumetricLightScattering'
import VolumetricLightCylinder from './shaders/VolumetricLightCylinder'

// Constants

const DEFAULT_LAYER = 0
const OCCLUSION_LAYER = 1

const FONT_MAP_SIZE = new THREE.Vector2(64, 64)
const FONT_CHAR_SIZE = new THREE.Vector2(8, 8)

// Sizes
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight,
}

// Create Scene + Camera

const mainScene = new THREE.Scene()
const cameraGroup = new THREE.Group()
mainScene.add(cameraGroup)

const mainCamera = new THREE.PerspectiveCamera(
  15,
  window.innerWidth / window.innerHeight,
  8,
  15
  // WIDE ANGLE VIEW
  // 35,
  // sizes.width / sizes.height,
  // 0.1,
  // 100
)
mainCamera.position.z = 12
cameraGroup.add(mainCamera)

const occlusionCamera = mainCamera.clone()
occlusionCamera.layers.set(OCCLUSION_LAYER)

// Add Point Lights

const backLight = new THREE.PointLight(0x00aaff, 8, 10)
backLight.layers.enable(OCCLUSION_LAYER)
backLight.position.set(-5, 5, -5)
mainScene.add(backLight)

const fillLight = new THREE.PointLight(0x00aaff, 5, 10)
fillLight.layers.enable(OCCLUSION_LAYER)
fillLight.position.set(-5, 0, 5)
mainScene.add(fillLight)

const keyLight = new THREE.PointLight(0xff00ff, 3, 10)
keyLight.layers.enable(OCCLUSION_LAYER)
keyLight.position.set(5, 0, 0)
mainScene.add(keyLight)

// Create Renderer

const renderer = new THREE.WebGLRenderer()
// Main Render Size
renderer.setSize(window.innerWidth, window.innerHeight)
document.getElementById('app').appendChild(renderer.domElement)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

// switch model code
// const modelsArray =[]
// setTimeout(() => {
//   for (let i = 0; i < modelsArray.length; i++) {
//     const modelFile = require( modelsArray[i]);

//   }
// }, 15000);
const loader = new GLTFLoader()
// Load 3D Model
const modelFile = require('../model/cybertruck.glb')
const modelContainer = new THREE.Group()
modelContainer.layers.enable(OCCLUSION_LAYER)
mainScene.add(modelContainer)

loader.load(
  modelFile,
  (gltf) => {
    // Add default mesh
    modelContainer.add(gltf.scene)

    // Add black mesh set to occlusion Layer
    const occlusionScene = gltf.scene.clone()
    const blackMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x000000),
    })
    occlusionScene.traverse((node) => {
      if (node.material) {
        node.material = blackMaterial
      }
      if (node.layers) {
        node.layers.set(OCCLUSION_LAYER)
      }
    })
    modelContainer.add(occlusionScene)

    // // Redundant
    // gltf.scene.scale.set(0.8, 0.8, 0.8)
  },
  undefined,
  console.error
)

// Other 3D Models
// const material = new THREE.MeshToonMaterial({ color: '#ffeded' })

// const mesh1 = new THREE.Mesh(new THREE.TorusGeometry(1, 0.4, 16, 60), material)
// const mesh2 = new THREE.Mesh(new THREE.ConeGeometry(1, 2, 32), material)
// const mesh3 = new THREE.Mesh(
//   new THREE.TorusKnotGeometry(0.8, 0.35, 100, 16),
//   material
// )
// // mainScene.add(mesh1, mesh2, mesh3)
const objectsDistance = 4
// mesh1.position.y = -objectsDistance * 0
// mesh2.position.y = -objectsDistance * 1
// mesh3.position.y = -objectsDistance * 2

// Generic

function getLowResSize() {
  const charCountPrecise = [
    window.innerWidth / FONT_CHAR_SIZE.x,
    window.innerHeight / FONT_CHAR_SIZE.y,
  ]

  const charCountCeil = charCountPrecise.map(Math.ceil)

  return {
    charCountPrecise,
    charCountCeil,
  }
}

const startingSizeData = getLowResSize()
const lowResRenderTarget = new THREE.WebGLRenderTarget(
  startingSizeData.charCountCeil[0] * 2,
  startingSizeData.charCountCeil[1] * 2
)

const lowResDepthTexture = new THREE.DepthTexture()
lowResDepthTexture.type = THREE.UnsignedShortType
lowResRenderTarget.depthTexture = lowResDepthTexture

const lowResEffectRenderTarget = new THREE.WebGLRenderTarget(
  startingSizeData.charCountCeil[0] * 2,
  startingSizeData.charCountCeil[1] * 2
)

const occlusionRenderTarget = new THREE.WebGLRenderTarget(
  startingSizeData.charCountCeil[0] * 2,
  startingSizeData.charCountCeil[1] * 2
)

// Ripple Effect

const RIPPLE_SPEED = 0.3
const RIPPLE_PEAK = 0.4

const ripples = []
const rippleCanvas = document.createElement('canvas')
rippleCanvas.width = rippleCanvas.style.width = window.innerWidth
rippleCanvas.height = rippleCanvas.style.height = window.innerHeight
const rippleContext = rippleCanvas.getContext('2d')
const rippleTexture = new THREE.Texture(rippleCanvas)
rippleTexture.minFilter = THREE.NearestFilter
rippleTexture.magFilter = THREE.NearestFilter

let rippleWasRendering = false

const canvas = document.getElementById('app')

const controls = new OrbitControls(mainCamera, canvas)
controls.panSpeed = 0.1
controls.maxDistance = 12.0
controls.minDistance = 12.0
controls.maxPolarAngle = Math.PI / 2
controls.minPolarAngle = Math.PI / 2
controls.rotateSpeed = 0.5

// Ripples
const linear = (t) => t
const easeOutQuart = (t) => 1 - --t * t * t * t

function renderRipples(delta) {
  if (ripples.length) {
    rippleWasRendering = true

    rippleContext.fillStyle = 'rgb(128, 128, 0)'
    rippleContext.fillRect(0, 0, rippleCanvas.width, rippleCanvas.height)

    ripples.forEach((ripple, i) => {
      ripple.age += delta * RIPPLE_SPEED

      if (ripple.age > 1) {
        ripples.splice(i, 1)
        return
      }

      const size = rippleCanvas.height * easeOutQuart(ripple.age)

      const alpha =
        ripple.age < RIPPLE_PEAK
          ? easeOutQuart(ripple.age / RIPPLE_PEAK)
          : 1 - linear((ripple.age - RIPPLE_PEAK) / (1 - RIPPLE_PEAK))

      let grd = rippleContext.createRadialGradient(
        ripple.position.x,
        ripple.position.y,
        size * 0.25,
        ripple.position.x,
        ripple.position.y,
        size
      )

      grd.addColorStop(1, `rgba(128, 128, 0, 0.5)`)
      grd.addColorStop(
        0.8,
        `rgba(${ripple.color.x}, ${ripple.color.y}, ${20 * alpha}, ${alpha})`
      )
      grd.addColorStop(0, `rgba(0, 0, 0, 0)`)

      rippleContext.beginPath()
      rippleContext.fillStyle = grd
      rippleContext.arc(
        ripple.position.x,
        ripple.position.y,
        size,
        0,
        Math.PI * 2
      )
      rippleContext.fill()
    })

    rippleTexture.needsUpdate = true
  } else if (rippleWasRendering) {
    rippleContext.fillStyle = 'rgb(128, 128, 0)'
    rippleContext.fillRect(0, 0, rippleCanvas.width, rippleCanvas.height)

    rippleWasRendering = false
    rippleTexture.needsUpdate = true
  }
}

function addRipple(event) {
  ripples.push({
    age: 0,
    position: new THREE.Vector2(event.clientX, event.clientY),
    color: new THREE.Vector2(
      (event.clientX / window.innerWidth) * 255,
      (event.clientY / window.innerHeight) * 255
    ),
  })
}
window.addEventListener('click', addRipple)

// New Code (Portfolio + Projects)
// let scrollY = window.scrollY
// let currentSection = 0
// window.addEventListener('scroll', () => {
//   scrollY = window.scrollY
//   //   console.log(scrollY)
// })

const particlesCount = 200
const positions = new Float32Array(particlesCount * 3)

for (let i = 0; i < particlesCount; i++) {
  positions[i * 3 + 0] = (Math.random() - 0.5) * 10
  positions[i * 3 + 1] =
    objectsDistance * 0.5 - Math.random() * objectsDistance * 3
  positions[i * 3 + 2] = (Math.random() - 0.5) * 10
}

const particlesGeometry = new THREE.BufferGeometry()
particlesGeometry.setAttribute(
  'position',
  new THREE.BufferAttribute(positions, 3)
)
const particlesMaterial = new THREE.ShaderMaterial(VertexLitParticle())

const particles = new THREE.Points(particlesGeometry, particlesMaterial)
mainScene.add(particles)

// Galaxy Particles Code experiment
// const particleGeometry = new THREE.SphereBufferGeometry(100, 32, 16)

// let _particleSpeeds = []

// for (let i = 0; i < parameters.count; i++) {
//   const x = Math.random() * frustumWidthHalf
//   const y = -Math.random() * frustumHeightHalf
//   const z = (Math.random() * 2 - 1) * (PARTICLE_DEPTH / 2)
//   _particlePositions.push(x, y, z)
//   _particleSpeeds.push(1 + Math.random() * PARTICLE_SPEED)
// }

// const particleSpeeds = new Float32Array(_particleSpeeds)
// const particleStartPositions = new Float32Array(_particlePositions)
// const particlePositions = new THREE.Float32BufferAttribute(
//   _particlePositions,
//   3
// )
// particleGeometry.setAttribute('position', particlePositions)

// const particleMaterial = new THREE.ShaderMaterial(VertexLitParticle())
// particleMaterial.uniforms.pointSize.value = 2.0
// particleMaterial.uniforms.decayModifier.value = 2.5
// const particles = new THREE.Points(particleGeometry, particleMaterial)
// particles.position.set(-5, 0, -8)
// particlesGroup.add(particles)

// const mousePositionNormalized = new THREE.Vector2(0, 0)

// function animateParticles(delta) {
//   let i = 0
//   for (let p = 0; p < parameters.count; p++) {
//     particlesAttribute.array[i] =
//       (particleStartPositions[i] *
//         frustumWidthHalf *
//         (1.0 + mousePositionNormalized.x * delta * 4.0) *
//         0.2) %
//       frustumWidth

//     particlesAttribute.array[i + 1] =
//       (particleStartPositions[i + 1] *
//         frustumHeightHalf *
//         (1.0 - mousePositionNormalized.y * delta * 4.0) *
//         0.1) %
//       frustumHeight

//     i += 3
//   }

//   particlesAttribute.needsUpdate = true
// }

// Volumetric Lighting

const lightGeometry = new THREE.CylinderGeometry(3, 6, 15, 32, 6, true)
lightGeometry.applyMatrix4(
  new THREE.Matrix4().makeTranslation(
    0,
    -lightGeometry.parameters.height / 2,
    0
  )
)
lightGeometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2))

const lightCylinderMaterial = new THREE.ShaderMaterial(
  VolumetricLightCylinder()
)
const lightConeTarget = new THREE.Vector3(0, 0, -8)
const lightCone = new THREE.Mesh(lightGeometry, lightCylinderMaterial)
lightCone.position.set(-5, 2, -8)
lightCone.layers.set(OCCLUSION_LAYER)
lightCylinderMaterial.uniforms.spotPosition.value = lightCone.position
mainScene.add(lightCone)

// ASCII Effect

const fontLoader = new THREE.TextureLoader()
const fontFile = require('../font.png')
const tFont = fontLoader.load(fontFile)
tFont.minFilter = THREE.NearestFilter
tFont.magFilter = THREE.NearestFilter

const asciiPass = new ShaderPass(ASCIIShader())
asciiPass.needsSwap = false
asciiPass.uniforms.tLowRes.value = lowResEffectRenderTarget.texture
asciiPass.uniforms.tDepth.value = lowResRenderTarget.depthTexture
asciiPass.uniforms.cameraNear.value = mainCamera.near / 0.6
asciiPass.uniforms.cameraFar.value = mainCamera.far * 0.35
asciiPass.uniforms.tFont.value = tFont

const fontCountX = FONT_MAP_SIZE.x / FONT_CHAR_SIZE.x
const fontCountY = FONT_MAP_SIZE.y / FONT_CHAR_SIZE.y

asciiPass.uniforms.fontCharTotalCount.value =
  Math.floor(fontCountX) * Math.floor(fontCountY)

asciiPass.uniforms.fontCharSize.value.set(1 / fontCountX, 1 / fontCountY)

asciiPass.uniforms.fontCharCount.value.set(fontCountX, fontCountY)

// Occlusion Composer

const occlusionComposer = new EffectComposer(renderer, occlusionRenderTarget)
occlusionComposer.renderToScreen = false

occlusionComposer.addPass(new RenderPass(mainScene, occlusionCamera))

const lightScatteringPass = new ShaderPass(VolumetricLightScattering())
lightScatteringPass.needsSwap = false
occlusionComposer.addPass(lightScatteringPass)

// Effect Composer

const effectComposer = new EffectComposer(renderer, lowResEffectRenderTarget)
effectComposer.renderToScreen = false

const additivePass = new ShaderPass(AdditiveShader())
additivePass.textureID = null
additivePass.uniforms.tDiffuse.value = lowResRenderTarget.texture
additivePass.uniforms.tAdd.value = occlusionRenderTarget.texture
effectComposer.addPass(additivePass)

const scanPass = new ShaderPass(ScanShader())
scanPass.uniforms.tDepth.value = lowResDepthTexture
scanPass.uniforms.cameraNear.value = mainCamera.near
scanPass.uniforms.cameraFar.value = mainCamera.far
effectComposer.addPass(scanPass)

const ripplePass = new ShaderPass(RippleShader())
ripplePass.uniforms.tRipple.value = rippleTexture
ripplePass.needsSwap = false
effectComposer.addPass(ripplePass)

// Final Composer

const finalComposer = new EffectComposer(renderer)
finalComposer.addPass(asciiPass)

// Mouse Move
const cursor = {}
cursor.x = 0
cursor.y = 0

window.addEventListener('mousemove', (event) => {
  cursor.x = event.clientX / sizes.width - 0.5
  cursor.y = event.clientY / sizes.height - 0.5
  lightCone.position.x = 5 * ((event.clientX / window.innerWidth) * 2 - 1)
  backLight.position.x = lightCone.position.x
})
function updateAsciiRenderSize() {
  const size = getLowResSize()

  asciiPass.uniforms.renderCharSize.value.set(
    1 / size.charCountPrecise[0],
    1 / size.charCountPrecise[1]
  )

  asciiPass.uniforms.renderCharCount.value.set(
    size.charCountPrecise[0],
    size.charCountPrecise[1]
  )

  lowResRenderTarget.setSize(
    size.charCountCeil[0] * 2,
    size.charCountCeil[1] * 2
  )

  effectComposer.setSize(size.charCountCeil[0] * 2, size.charCountCeil[1] * 2)

  occlusionComposer.setSize(
    size.charCountCeil[0] * 2,
    size.charCountCeil[1] * 2
  )
}

// Handle Window Resize
function resizeRenderer() {
  if (window.innerWidth <= 500) {
    rippleCanvas.width = rippleCanvas.style.width = window.innerWidth / 2
    rippleCanvas.height = rippleCanvas.style.height = window.innerHeight / 2
    canvas.width = canvas.style.width = window.innerWidth / 2
    canvas.height = canvas.style.height = window.innerHeight / 2
    updateAsciiRenderSize()
    // Canvas Height Control
    renderer.setSize(window.innerWidth, window.innerHeight)
    mainCamera.aspect = window.innerWidth / window.innerHeight
    mainCamera.updateProjectionMatrix()
    occlusionCamera.aspect = mainCamera.aspect
    occlusionCamera.updateProjectionMatrix()
    modelContainer.scale.set(0.5, 0.5, 0.5)
  } else if (window.innerWidth > 500 && window.innerWidth <= 768) {
    rippleCanvas.width = rippleCanvas.style.width = window.innerWidth / 2
    rippleCanvas.height = rippleCanvas.style.height = window.innerHeight / 2
    canvas.width = canvas.style.width = window.innerWidth / 2
    canvas.height = canvas.style.height = window.innerHeight / 2
    updateAsciiRenderSize()
    // Canvas Height Control
    renderer.setSize(window.innerWidth, window.innerHeight)
    mainCamera.aspect = window.innerWidth / window.innerHeight
    mainCamera.updateProjectionMatrix()
    occlusionCamera.aspect = mainCamera.aspect
    occlusionCamera.updateProjectionMatrix()
    modelContainer.scale.set(0.6, 0.6, 0.6)
  } else if (window.innerWidth > 768) {
    rippleCanvas.width = rippleCanvas.style.width = window.innerWidth
    rippleCanvas.height = rippleCanvas.style.height = window.innerHeight
    canvas.width = canvas.style.width = window.innerWidth
    canvas.height = canvas.style.height = window.innerHeight
    updateAsciiRenderSize()
    // Canvas Height Control
    renderer.setSize(window.innerWidth, window.innerHeight)
    mainCamera.aspect = window.innerWidth / window.innerHeight
    mainCamera.updateProjectionMatrix()
    occlusionCamera.aspect = mainCamera.aspect
    occlusionCamera.updateProjectionMatrix()
    modelContainer.scale.set(0.8, 0.8, 0.8)
  }
}
window.addEventListener('resize', debounce(resizeRenderer, 50))

// Render Scene

const clock = new THREE.Clock()
let previousTime = 0

modelContainer.rotation.x = 0.1
modelContainer.position.z = 0.4
modelContainer.position.y = 0.3

resizeRenderer()
function render() {
  const elapsedTime = clock.getElapsedTime()
  const delta = elapsedTime - previousTime
  previousTime = elapsedTime

  // Animate Camera (When Projects Sections Added)
  // mainCamera.position.y = (-scrollY / sizes.height) * objectsDistance

  const parallaxX = cursor.x * 0.5
  const parallaxY = -cursor.y * 0.5
  cameraGroup.position.x += (parallaxX - cameraGroup.position.x) * 5 * delta
  cameraGroup.position.y += (parallaxY - cameraGroup.position.y) * 5 * delta

  // Object Animation
  modelContainer.rotation.y += delta / 2.2
  // Drifting pixels - Speed Now Reduced.(Epilepsy Measure)
  particles.rotation.y += delta * 0.3
  // particlesGroup.position.x += -delta / 0.5

  // Scan
  scanPass.uniforms.scan.value =
    (scanPass.uniforms.scan.value + delta * 0.5) % 2

  // Volumetric Lighting

  lightCone.lookAt(lightConeTarget)
  lightCylinderMaterial.uniforms.spotPosition.value = lightCone.position
  const lightConePosition = lightCone.position.clone()
  const vector = lightConePosition.project(occlusionCamera)
  lightScatteringPass.uniforms.lightPosition.value.set(
    (vector.x + 1) / 2,
    (vector.y + 1) / 2
  )

  // Render

  renderRipples(delta)

  renderer.setRenderTarget(lowResRenderTarget)
  renderer.render(mainScene, mainCamera)

  renderer.setRenderTarget(occlusionRenderTarget)
  occlusionComposer.render()

  renderer.setRenderTarget(lowResEffectRenderTarget)
  effectComposer.render()

  renderer.setRenderTarget(null)
  finalComposer.render()
  // animateParticles(delta)
  requestAnimationFrame(render)
}
render()
