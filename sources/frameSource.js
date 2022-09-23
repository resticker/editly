import assert from 'assert';
import pMap from 'p-map';

import {
  rgbaToFabricImage,
  createCustomCanvasFrameSource,
  createFabricFrameSource,
  createFabricCanvas,
  renderFabricCanvas,
} from './fabric.js';
import {
  customFabricFrameSource,
  subtitleFrameSource,
  titleFrameSource,
  newsTitleFrameSource,
  fillColorFrameSource,
  radialGradientFrameSource,
  linearGradientFrameSource,
  imageFrameSource,
  imageOverlayFrameSource,
  slideInTextFrameSource,
} from './fabric/fabricFrameSources.js';
import createVideoFrameSource from './videoFrameSource.js';
import createGlFrameSource from './glFrameSource.js';

const fabricFrameSources = {
  fabric: customFabricFrameSource,
  image: imageFrameSource,
  'image-overlay': imageOverlayFrameSource,
  title: titleFrameSource,
  subtitle: subtitleFrameSource,
  'linear-gradient': linearGradientFrameSource,
  'radial-gradient': radialGradientFrameSource,
  'fill-color': fillColorFrameSource,
  'news-title': newsTitleFrameSource,
  'slide-in-text': slideInTextFrameSource,
};

export async function createFrameSource({ clip, clipIndex, width, height, channels, verbose, logTimes, ffmpegPath, ffprobePath, enableFfmpegLog, framerateStr }) {
  const { layers, duration } = clip;

  const visualLayers = layers.filter((layer) => layer.type !== 'audio');

  const layerFrameSources = await pMap(visualLayers, async (layer, layerIndex) => {
    const { type, ...params } = layer;
    if (verbose) console.log('createFrameSource', type, 'clip', clipIndex, 'layer', layerIndex);

    let createFrameSourceFunc;
    if (fabricFrameSources[type]) {
      createFrameSourceFunc = async (opts) => createFabricFrameSource(fabricFrameSources[type], opts);
    } else {
      createFrameSourceFunc = {
        video: createVideoFrameSource,
        gl: createGlFrameSource,
        canvas: createCustomCanvasFrameSource,
      }[type];
    }

    assert(createFrameSourceFunc, `Invalid type ${type}`);

    const frameSource = await createFrameSourceFunc({ ffmpegPath, ffprobePath, width, height, duration, channels, verbose, logTimes, enableFfmpegLog, framerateStr, params });
    return { layer, frameSource };
  }, { concurrency: 1 });

  async function readNextFrame({ time, lastCanvasObjects }) {
    const canvas = createFabricCanvas({ width, height });

    // eslint-disable-next-line no-restricted-syntax
    for (const { frameSource, layer } of layerFrameSources) {
      // console.log({ start: layer.start, stop: layer.stop, layerDuration: layer.layerDuration, time });
      const offsetProgress = (time - (layer.start)) / layer.layerDuration;
      // console.log({ offsetProgress });
      const shouldDrawLayer = offsetProgress >= 0 && offsetProgress <= 1;

      if (shouldDrawLayer) {
        if (logTimes) console.time('frameSource.readNextFrame');
        const rgba = await frameSource.readNextFrame(offsetProgress, canvas);
        if (logTimes) console.timeEnd('frameSource.readNextFrame');

        // Frame sources can either render to the provided canvas and return nothing
        // OR return an raw RGBA blob which will be drawn onto the canvas
        if (rgba) {
          // Optimization: Don't need to draw to canvas if there's only one layer
          if (layerFrameSources.length === 1) return rgba;

          if (logTimes) console.time('rgbaToFabricImage');
          const img = await rgbaToFabricImage({ width, height, rgba });
          if (logTimes) console.timeEnd('rgbaToFabricImage');
          canvas.add(img);
        } else {
          // Assume this frame source has drawn its content to the canvas
        }
      }
    }
    // if (verbose) console.time('Merge frames');

    // TODO: Look for serializer that's faster than stringify? Maybe stringify is fast enough?
    // eslint-disable-next-line no-underscore-dangle
    const objectsString = JSON.stringify(canvas._objects); // TODO: Use library like fast-deep-equal to compare this property (ACTUALLY, I think the more important thing is to find a faster way of copying this object property like fast-copy)
    // TODO: Only use this if optimization is turned on? (or just have it on all the time for my fork)
    if (lastCanvasObjects && objectsString === lastCanvasObjects) {
      // console.log("equal!");
      canvas.clear();
      canvas.dispose();
      return [undefined, objectsString]; // Return early if canvas hasn't changed
    }

    if (logTimes) console.time('renderFabricCanvas');
    const rgba = await renderFabricCanvas(canvas);
    if (logTimes) console.timeEnd('renderFabricCanvas');
    return [rgba, objectsString];
  }

  async function close() {
    await pMap(layerFrameSources, async ({ frameSource }) => frameSource.close());
  }

  return {
    readNextFrame,
    close,
  };
}

export default {
  createFrameSource,
};
