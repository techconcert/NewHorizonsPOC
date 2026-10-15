import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RedFormat,
  UnsignedByteType,
  type MeshLambertMaterial,
} from 'three';
import { FOG_TEX_SIZE } from './fogTexture';

/**
 * The fog look as a patch on MeshLambertMaterial: terrain, props and buildings all sample the one
 * fog DataTexture by their world x/z. Hidden ground turns into a dark painted-map parchment (the
 * colour underneath only survives as faint relief), visible ground is muted and warm-grey, and
 * explored ground keeps its full colour. The texture is bilinear, so the borders fade.
 */

export interface FogUniforms {
  tex: { value: DataTexture };
  /** Half width of the square the texture covers, in world units. */
  ext: { value: number };
}

export function createFogUniforms(): { uniforms: FogUniforms; data: Uint8Array } {
  const data = new Uint8Array(FOG_TEX_SIZE * FOG_TEX_SIZE);
  const tex = new DataTexture(data, FOG_TEX_SIZE, FOG_TEX_SIZE, RedFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { uniforms: { tex: { value: tex }, ext: { value: 8 } }, data };
}

const VERTEX_VARYING = 'varying vec3 vFogPos;';
const VERTEX_WORLD = /* glsl */ `
  vec4 fogW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogW = instanceMatrix * fogW;
  #endif
  vFogPos = ( modelMatrix * fogW ).xyz;
`;
const FRAGMENT_PARS = /* glsl */ `
  varying vec3 vFogPos;
  uniform sampler2D uFogTex;
  uniform float uFogExt;
`;
const FRAGMENT_TINT = /* glsl */ `
  {
    float fogV = texture2D( uFogTex, ( vFogPos.xz + vec2( uFogExt ) ) / ( 2.0 * uFogExt ) ).r;
    float lum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
    float paper = fract( sin( dot( floor( vFogPos.xz * 6.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    vec3 hiddenCol = vec3( 0.062, 0.050, 0.036 ) * ( 0.94 + 0.12 * paper ) + vec3( lum * 0.25 );
    vec3 mutedCol = mix( diffuseColor.rgb, vec3( lum ) * vec3( 1.1, 1.0, 0.82 ), 0.5 ) * 0.78;
    float toVisible = clamp( fogV * 2.0, 0.0, 1.0 );
    float toExplored = clamp( fogV * 2.0 - 1.0, 0.0, 1.0 );
    diffuseColor.rgb = mix( mix( hiddenCol, mutedCol, toVisible ), diffuseColor.rgb, toExplored );
  }
`;

/** Patch `material` (vertexColors on) to read the fog. Safe for plain and instanced meshes. */
export function applyFogShading(material: MeshLambertMaterial, fog: FogUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFogTex = fog.tex;
    shader.uniforms.uFogExt = fog.ext;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_VARYING}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_WORLD}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_TINT}`);
  };
  material.customProgramCacheKey = () => 'planet-fog-v1';
}
