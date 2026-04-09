<script>
  import { Canvas, T } from '@threlte/core'
  import { OrbitControls } from '@threlte/extras'
</script>

<div class="relative min-h-[420px] min-w-0 flex-1">
  <Canvas>
    <T.Color attach="background" args={[0x000000]} />
    <T.PerspectiveCamera makeDefault position={[2.8, 2.2, 2.8]} fov={45} />
    <OrbitControls enableDamping dampingFactor={0.08} />
    <T.AmbientLight intensity={0.4} />
    <T.DirectionalLight position={[5, 8, 4]} intensity={1.1} />
    <T.Mesh rotation={[0.4, 0.75, 0]}>
      <T.TorusKnotGeometry args={[0.55, 0.16, 128, 32]} />
      <T.MeshStandardMaterial color="#5b9fff" metalness={0.25} roughness={0.45} />
    </T.Mesh>
  </Canvas>
</div>
