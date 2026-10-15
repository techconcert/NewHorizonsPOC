import { BackSide, Mesh, ShaderMaterial, SphereGeometry, type Scene } from 'three';

/**
 * Backdrop of the planet view: a very large, nearly flat ocean (a sphere, so the horizon curves
 * away when the camera tilts) and a sky dome whose horizon glows like an atmosphere seen edge on.
 * Both use raw sRGB colours in tiny shaders (no lights, no textures), so they cost two draw calls.
 */

/** Ocean surface height: just below the foot of the tiles (SKIRT_BOTTOM in terrainMesh.ts). */
export const OCEAN_Y = -0.2;
export const OCEAN_RADIUS = 600;
export const SKY_RADIUS = 1500;

const OCEAN_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4( position, 1.0 );
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const OCEAN_FRAGMENT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    float d = length( vWorld.xz );
    vec3 deep = vec3( 0.020, 0.050, 0.095 );
    vec3 shallow = vec3( 0.075, 0.250, 0.320 );
    vec3 col = mix( deep, shallow, smoothstep( 22.0, 0.0, d ) );
    float ripple = sin( vWorld.x * 2.3 + vWorld.z * 1.1 ) * sin( vWorld.z * 1.9 - vWorld.x * 0.7 );
    col += vec3( 0.012, 0.022, 0.026 ) * ripple * smoothstep( 40.0, 0.0, d );
    col = mix( col, vec3( 0.027, 0.043, 0.078 ), smoothstep( 30.0, 160.0, d ) );
    gl_FragColor = vec4( col, 1.0 );
  }
`;
const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 w = modelMatrix * vec4( position, 1.0 );
    vDir = w.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const SKY_FRAGMENT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // Height above the true horizon: the ocean sphere's edge sits a little below eye level.
    float dip = sqrt( max( 2.0 * ( cameraPosition.y + 0.2 ) / 600.0, 0.0 ) );
    float h = normalize( vDir ).y + dip;
    vec3 space = vec3( 0.027, 0.043, 0.078 );
    vec3 rim = vec3( 0.30, 0.52, 0.95 );
    // A thin bright band at the horizon (the atmosphere seen edge on) and a faint haze above it.
    float band = exp( -max( h, 0.0 ) * 22.0 );
    float haze = exp( -max( h, 0.0 ) * 4.0 );
    gl_FragColor = vec4( space + rim * ( 0.5 * band + 0.1 * haze ), 1.0 );
  }
`;

export interface Backdrop {
  dispose(): void;
}

export function createBackdrop(scene: Scene): Backdrop {
  const oceanGeo = new SphereGeometry(OCEAN_RADIUS, 64, 32);
  const oceanMat = new ShaderMaterial({
    vertexShader: OCEAN_VERTEX,
    fragmentShader: OCEAN_FRAGMENT,
  });
  const ocean = new Mesh(oceanGeo, oceanMat);
  ocean.position.set(0, OCEAN_Y - OCEAN_RADIUS, 0);
  ocean.frustumCulled = false;
  ocean.renderOrder = -2;
  scene.add(ocean);

  // The sky: a dome around the camera, drawn first with no depth, so the horizon glows and the
  // space above fades to the clear colour.
  const skyGeo = new SphereGeometry(SKY_RADIUS, 32, 16);
  const skyMat = new ShaderMaterial({
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const sky = new Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  return {
    dispose() {
      scene.remove(ocean);
      scene.remove(sky);
      oceanGeo.dispose();
      oceanMat.dispose();
      skyGeo.dispose();
      skyMat.dispose();
    },
  };
}
