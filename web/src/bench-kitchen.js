import * as THREE from 'three';

// The 3D kitchen (the 群核 scene, culled to what this view can see and thinned of faint splats: 开发归档/厨房场景压缩试验)
// behind the build bench only, on with ?scene=kitchen (Elara #万物对战:207a725b 957a335b). main.js asks for it once the bench
// can be used and a match has all it needs; until it is in, and in every fight, the usual backdrop stays.
const SCENE_URL = new URL('../../data/scenes/kitchen/scene.spz', import.meta.url).href;
// The room is a reconstruction around one observation point: the camera only turns there (moving it shows the gaps),
// a slow sway that tells it is a room and not a picture.
const EYE = new THREE.Vector3(0, 5, 10), FOV = 70, EXPOSURE = 0.85, FADE = 0.8, SWAY = {yaw: 2.4, pitch: 0.7, period: 19};

export class BenchKitchen {
  constructor(stage, {back, field, material}) {
    this.stage = stage;
    this.backdrop = {back, field, material};
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 390 / 844, 0.01, 200);
    this.fov = FOV;
    this.exposure = EXPOSURE;
    this.shown = 0;
    this.time = 0;
    this.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Asks for the kitchen: it starts coming down the next time the bench is up, so Spark (2.6 MB of script) never lands mid-fight. */
  want() { this.wanted = true; }

  /** Fetches the renderer (Spark) and the scene; resolves once the splats can be drawn. */
  load() {
    // A download begun on the bench can finish in a fight: the setup (scene file, decoding, shaders) still waits for the
    // bench to be up again (Sol 79525cfb).
    return this.loading ??= import('@sparkjsdev/spark').then(spark => new Promise(go => { this.onBench = () => go(spark); }))
      .then(({SparkRenderer, SplatMesh}) => {
      this.spark = new SparkRenderer({renderer: this.stage.renderer, depthTest: false, depthWrite: false});
      this.scene.add(this.spark);
      // Placed as the 3D kitchen preview places it (kitchen.js INITIAL): observation point at EYE, facing the room.
      const room = new THREE.Group();
      room.position.copy(EYE);
      room.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(EYE, new THREE.Vector3(), THREE.Object3D.DEFAULT_UP))
        .multiply(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -Math.PI / 2));
      room.scale.setScalar(2.4);
      this.mesh = new SplatMesh({url: SCENE_URL, lod: false});
      // Aholo reports Z-up; the game uses Y-up.
      this.mesh.rotation.x = -Math.PI / 2;
      room.add(this.mesh);
      this.scene.add(room);
      return this.mesh.initialized;
    }).then(() => { this.ready = true; });
  }

  /** Draws the frame (kitchen, then the game scene over it) when the bench shows it; false leaves it to the stage. */
  draw(building, dt) {
    if (building && this.wanted && !this.loading) this.load().catch(e => console.warn('厨房场景没载入', e));
    if (building && this.onBench) { this.onBench(); this.onBench = null; }
    this.shown = this.ready && building ? Math.min(1, this.shown + dt / FADE) : 0;
    if (!this.shown) return false;
    const {renderer, scene, camera, view} = this.stage, {back, field, material} = this.backdrop;
    this.time += dt;
    const phase = this.still ? 0 : this.time * 2 * Math.PI / SWAY.period;
    this.camera.aspect = view.w / view.h;
    this.camera.fov = this.fov;
    this.camera.position.copy(EYE);
    this.camera.lookAt(0, 0, 0);
    this.camera.rotateOnWorldAxis(THREE.Object3D.DEFAULT_UP, THREE.MathUtils.degToRad(SWAY.yaw * Math.sin(phase)));
    this.camera.rotateX(THREE.MathUtils.degToRad(SWAY.pitch * Math.sin(phase * 0.5)));
    this.camera.updateProjectionMatrix();
    renderer.autoClear = false;
    renderer.clear();
    const exposure = renderer.toneMappingExposure;
    renderer.toneMappingExposure = exposure * this.exposure;
    renderer.render(this.scene, this.camera);
    renderer.toneMappingExposure = exposure;
    renderer.clearDepth();
    // The game's own backdrop fades out over the kitchen as it comes in, then stays off while the bench is up.
    const was = {background: scene.background, back: back.visible, field: field.visible};
    scene.background = null;
    back.visible = false;
    field.visible = field.visible && this.shown < 1;
    material.transparent = true;
    material.uniforms.fieldFade.value = 1 - this.shown;
    renderer.render(scene, camera);
    scene.background = was.background;
    back.visible = was.back;
    field.visible = was.field;
    material.transparent = false;
    material.uniforms.fieldFade.value = 1;
    renderer.autoClear = true;
    return true;
  }
}
