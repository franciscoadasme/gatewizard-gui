/** Runtime registry of directional lights mounted by SceneDirectionalLight. */
export const sceneDirectionalLightRegistry = {
  /** @type {Map<number, import('three').DirectionalLight>} */
  byIndex: new Map()
}
