import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation'
import { VRM_EMOTIONS, speakingMouth, vrmEmotionWeights, type VrmEmotion } from '@/lib/vn/vrm'
import { restingArms, selectVrmMotion, VRM_MOTION_SLOTS, vrmArmSign, waveWeight, wavingRightArm, type VrmMotions, type VrmMotionSlot } from '@/lib/vn/vrmMotion'

/**
 * One cast member rendered from a VRM model on its own transparent canvas, framed full-height so it
 * stands in the same slot a 2D sprite would. Loaded lazily by `VNStage` (three.js is only fetched
 * once a character actually has a model enabled); any load or WebGL failure calls `onError`, and the
 * stage falls back to the character's 2D sprite.
 */
export default function VrmFigure({
  url,
  motions,
  label,
  expression,
  speaking,
  gesture,
  gestureNonce = 0,
  reducedMotion,
  onError,
}: {
  url: string
  motions?: VrmMotions
  label: string
  expression: string
  speaking: boolean
  gesture?: 'wave' | 'smile'
  gestureNonce?: number
  reducedMotion: boolean
  onError: (error: unknown) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Read by the render loop every frame, so expression/speaking changes never rebuild the scene.
  const liveRef = useRef({ expression, speaking, gesture, gestureNonce, reducedMotion })
  liveRef.current = { expression, speaking, gesture, gestureNonce, reducedMotion }
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const motionKey = JSON.stringify(motions ?? {})

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    } catch (e) {
      onErrorRef.current(e)
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 50)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(0.6, 1.8, 2.5)
    scene.add(key)

    let vrm: VRM | undefined
    let rightLowerArmRestZ = 0
    // VRM 0.x and 1.0 turn the arm bones opposite ways (`vrmArmSign`).
    let armSign: 1 | -1 = -1
    let mixer: THREE.AnimationMixer | undefined
    const clips: Partial<Record<VrmMotionSlot, THREE.AnimationClip>> = {}
    let activeSlot: VrmMotionSlot | undefined
    let activeAction: THREE.AnimationAction | undefined
    let disposed = false
    let raf = 0
    const timer = new THREE.Timer()
    const weights: Record<VrmEmotion, number> = { happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0 }
    let nextBlink = 1.5 + Math.random() * 3
    let blinkStart = -1
    let seenGestureNonce = gestureNonce
    let gestureStart = -Infinity
    let activeGesture: 'wave' | 'smile' | undefined

    // Fit the whole figure: height drives the distance, and a narrow slot pulls the camera back
    // further so the arms never clip.
    const frame = () => {
      if (!vrm) return
      const box = new THREE.Box3().setFromObject(vrm.scene)
      const size = box.getSize(new THREE.Vector3())
      const centerY = (box.min.y + box.max.y) / 2
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
      const byHeight = (size.y * 0.54) / Math.tan(halfFov)
      const byWidth = (size.x * 0.54) / (Math.tan(halfFov) * camera.aspect)
      camera.position.set(0, centerY, Math.max(byHeight, byWidth) + size.z)
      camera.lookAt(0, centerY, 0)
      camera.updateProjectionMatrix()
    }
    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      frame()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)

    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const motionLoader = new GLTFLoader()
    motionLoader.register((parser) => new VRMAnimationLoaderPlugin(parser))
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    loader
      .loadAsync(url)
      .then((gltf) => {
        const loaded = gltf.userData.vrm as VRM | undefined
        if (disposed) {
          if (loaded) VRMUtils.deepDispose(loaded.scene)
          return
        }
        if (!loaded) throw new Error('This file is a glTF model but not a VRM.')
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        VRMUtils.rotateVRM0(loaded)
        // Out of the T-pose: arms rest at the sides.
        const leftArm = loaded.humanoid.getNormalizedBoneNode('leftUpperArm')
        const rightArm = loaded.humanoid.getNormalizedBoneNode('rightUpperArm')
        rightLowerArmRestZ = loaded.humanoid.getNormalizedBoneNode('rightLowerArm')?.rotation.z ?? 0
        armSign = vrmArmSign(loaded.meta?.metaVersion)
        const rest = restingArms(armSign)
        if (leftArm) leftArm.rotation.z = rest.left
        if (rightArm) rightArm.rotation.z = rest.right
        loaded.update(0)
        vrm = loaded
        mixer = new THREE.AnimationMixer(loaded.scene)
        scene.add(loaded.scene)
        resize()
        for (const slot of VRM_MOTION_SLOTS) {
          const motionUrl = motions?.[slot]
          if (!motionUrl) continue
          motionLoader.loadAsync(motionUrl).then((motionGltf) => {
            try {
              if (disposed || !vrm) return
              const animation = motionGltf.userData.vrmAnimations?.[0]
              if (!animation) throw new Error('File has no VRM animation.')
              // Face, blink, and mouth remain under the existing expression controls.
              animation.expressionTracks.preset.clear()
              animation.expressionTracks.custom.clear()
              animation.lookAtTrack = null
              const clip = createVRMAnimationClip(animation, vrm)
              if (!clip.tracks.length) throw new Error('VRM animation has no humanoid tracks.')
              clips[slot] = clip
            } finally {
              VRMUtils.deepDispose(motionGltf.scene)
            }
          }).catch((e) => {
            if (!disposed) console.warn(`${label}: ${slot} VRMA motion could not load; using the default motion.`, e)
          })
        }
      })
      .catch((e) => {
        if (!disposed) onErrorRef.current(e)
      })

    const tick = () => {
      raf = requestAnimationFrame(tick)
      timer.update()
      const dt = Math.min(timer.getDelta(), 0.1)
      const t = timer.getElapsed()
      if (vrm) {
        const motionDisabled = liveRef.current.reducedMotion || prefersReducedMotion.matches
        if (liveRef.current.gestureNonce !== seenGestureNonce) {
          seenGestureNonce = liveRef.current.gestureNonce
          gestureStart = t
          activeGesture = liveRef.current.gesture
        }
        const gestureElapsed = t - gestureStart
        const waving = !motionDisabled && activeGesture === 'wave' ? waveWeight(gestureElapsed) : 0
        const smiling = activeGesture === 'smile' && gestureElapsed < 2.6
        const requested = selectVrmMotion(motions, liveRef.current.expression, liveRef.current.speaking)
        const slot = clips[requested] ? requested : clips.idle ? 'idle' : undefined
        if (slot !== activeSlot) {
          activeAction?.fadeOut(0.25)
          activeSlot = slot
          activeAction = slot && mixer ? mixer.clipAction(clips[slot]!).reset().fadeIn(0.25).play() : undefined
        }
        if (!motionDisabled) mixer?.update(dt)
        const manager = vrm.expressionManager
        const target = vrmEmotionWeights(smiling ? 'happy' : liveRef.current.expression)
        for (const e of VRM_EMOTIONS) {
          weights[e] += (target[e] - weights[e]) * Math.min(1, dt * 8)
          manager?.setValue(e, weights[e])
        }
        manager?.setValue('aa', motionDisabled ? 0 : speakingMouth(liveRef.current.speaking, t))
        if (!motionDisabled && blinkStart < 0 && t > nextBlink) blinkStart = t
        const blinkPhase = blinkStart < 0 ? 1 : (t - blinkStart) / 0.16
        manager?.setValue('blink', !motionDisabled && blinkPhase < 1 ? Math.sin(blinkPhase * Math.PI) : 0)
        if (blinkPhase >= 1 && blinkStart >= 0) {
          blinkStart = -1
          nextBlink = t + 2 + Math.random() * 4
        }
        if (!activeAction || !clips[requested]) {
          const spine = vrm.humanoid.getNormalizedBoneNode('spine')
          if (spine) spine.rotation.z = motionDisabled ? 0 : Math.sin(t * 0.9) * 0.015
          const chest = vrm.humanoid.getNormalizedBoneNode('chest')
          if (chest) chest.rotation.x = motionDisabled ? 0 : Math.sin(t * (liveRef.current.speaking ? 3 : 1.6)) * (liveRef.current.speaking ? 0.025 : 0.01)
          const head = vrm.humanoid.getNormalizedBoneNode('head')
          if (head) head.rotation.x = !motionDisabled && liveRef.current.speaking ? Math.sin(t * 3.2) * 0.02 : 0
          const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm')
          if (leftArm) leftArm.rotation.z = restingArms(armSign).left + (!motionDisabled && liveRef.current.speaking ? Math.sin(t * 2.4) * 0.05 : 0)
          const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
          if (rightArm) rightArm.rotation.z = restingArms(armSign).right + (!motionDisabled && liveRef.current.speaking ? Math.sin(t * 2.4 + 1.5) * 0.05 : 0)
          const rightLowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm')
          if (rightLowerArm) rightLowerArm.rotation.z = rightLowerArmRestZ
        }
        if (waving) {
          const upperArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
          const lowerArm = vrm.humanoid.getNormalizedBoneNode('rightLowerArm')
          const pose = wavingRightArm(armSign, Math.sin(gestureElapsed * 14) * 0.2)
          if (upperArm) upperArm.rotation.z = THREE.MathUtils.lerp(upperArm.rotation.z, pose.upper, waving)
          if (lowerArm) lowerArm.rotation.z = THREE.MathUtils.lerp(lowerArm.rotation.z, pose.lower, waving)
        }
        vrm.update(dt)
      }
      renderer.render(scene, camera)
    }
    tick()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      timer.dispose()
      observer.disconnect()
      if (mixer && vrm) {
        mixer.stopAllAction()
        mixer.uncacheRoot(vrm.scene)
      }
      if (vrm) VRMUtils.deepDispose(vrm.scene)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [url, motionKey])

  return <div ref={hostRef} role="img" aria-label={`${label} (3D model)`} className="h-full w-full" data-testid="vrm-figure" />
}
