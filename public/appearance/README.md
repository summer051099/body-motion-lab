# Velora athlete appearance surface

This is a real, unified three-dimensional mesh derived from the existing
BodyExplorer muscle and skeletal geometry. It is a separate appearance asset;
the original anatomical muscle IDs, geometry, and shared motion skeleton remain
in the project.

`athlete-surface.blend` is the editable rest mesh. `athlete-surface.json` contains
positions, normals, triangle indices, and construction metadata in the runtime
Y-up coordinate system, measured in metres. The runtime skin/muscle transfer is
stored separately so the appearance can be rebuilt without replacing the rig.

Rebuild locally:

```sh
blender --background --python tools/appearance/build_surface.py
blender --background --python tools/appearance/render_surface.py
```

The surface preserves the original major muscle contours, reduces local bulk
around existing bone axes, and closes the cut edges and narrow gaps of the
dissection meshes. The head is a complete faceless sculpted loft. Palms,
individual fingers, feet, and toes use measured source anatomy with complete
soft-tissue envelopes. The resulting surface is manifold and contains no
two-dimensional substitutes, fixed red regions, or independent view models.

Source attribution follows the retained project assets: BodyParts3D, DBCLS,
CC BY-SA 2.1 Japan; Z-Anatomy, Gauthier Kervyn, CC BY-SA 4.0. This derived
appearance mesh retains those source attributions and applicable share-alike
terms. See the project's attribution documentation for original source links.
