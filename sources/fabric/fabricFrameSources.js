const { fabric } = require('fabric');
const fileUrl = require('file-url');

const { getRandomGradient, getRandomColors } = require('../../colors');
const {
  easeOutExpo,
  easeInOutCubic,
  clampedEaseOutExpo,
  clampedEaseInOutCubic,
} = require('../../transitions');
const { getPositionProps, getFrameByKeyFrames, isUrl } = require('../../util');
const { blurImage } = require('../fabric');

// http://fabricjs.com/kitchensink

const defaultFontFamily = 'sans-serif';

const loadImage = async (pathOrUrl) => new Promise((resolve) => fabric.util.loadImage(
  isUrl(pathOrUrl) ? pathOrUrl : fileUrl(pathOrUrl),
  resolve,
));

function getZoomParams({ progress, zoomDirection, zoomAmount }) {
  let scaleFactor = 1;
  if (zoomDirection === 'in') scaleFactor = 1 + zoomAmount * progress;
  else if (zoomDirection === 'out') {
    scaleFactor = 1 + zoomAmount * (1 - progress);
  }
  return scaleFactor;
}

async function imageFrameSource({ verbose, params, width, height }) {
  const {
    path,
    zoomDirection = 'in',
    zoomAmount = 0.1,
    resizeMode = 'contain-blur',
  } = params;

  if (verbose) console.log('Loading', path);

  const imgData = await loadImage(path);

  const createImg = () => new fabric.Image(imgData, {
    originX: 'center',
    originY: 'center',
    left: width / 2,
    top: height / 2,
  });

  let blurredImg;
  // Blurred version
  if (resizeMode === 'contain-blur') {
    // If we dispose mutableImg, seems to cause issues with the rendering of blurredImg
    const mutableImg = createImg();
    if (verbose) console.log('Blurring background');
    blurredImg = await blurImage({ mutableImg, width, height });
  }

  async function onRender(progress, canvas) {
    const img = createImg();

    const scaleFactor = getZoomParams({ progress, zoomDirection, zoomAmount });

    const ratioW = width / img.width;
    const ratioH = height / img.height;

    if (['contain', 'contain-blur'].includes(resizeMode)) {
      if (ratioW > ratioH) {
        img.scaleToHeight(height * scaleFactor);
      } else {
        img.scaleToWidth(width * scaleFactor);
      }
    } else if (resizeMode === 'cover') {
      if (ratioW > ratioH) {
        img.scaleToWidth(width * scaleFactor);
      } else {
        img.scaleToHeight(height * scaleFactor);
      }
    } else if (resizeMode === 'stretch') {
      img.setOptions({
        scaleX: (width / img.width) * scaleFactor,
        scaleY: (height / img.height) * scaleFactor,
      });
    }

    if (blurredImg) canvas.add(blurredImg);
    canvas.add(img);
  }

  function onClose() {
    if (blurredImg) blurredImg.dispose();
    // imgData.dispose();
  }

  return { onRender, onClose };
}

async function fillColorFrameSource({ params, width, height }) {
  const { color } = params;

  const randomColor = getRandomColors(1)[0];

  async function onRender(progress, canvas) {
    const rect = new fabric.Rect({
      left: 0,
      right: 0,
      width,
      height,
      fill: color || randomColor,
    });
    canvas.add(rect);
  }

  return { onRender };
}

function getRekt(width, height) {
  // width and height with room to rotate
  return new fabric.Rect({
    originX: 'center',
    originY: 'center',
    left: width / 2,
    top: height / 2,
    width: width * 2,
    height: height * 2,
  });
}

async function radialGradientFrameSource({ width, height, params }) {
  const { colors: inColors } = params;

  const randomColors = getRandomGradient();

  async function onRender(progress, canvas) {
    // console.log('progress', progress);

    const max = Math.max(width, height);

    const colors = inColors && inColors.length === 2 ? inColors : randomColors;

    const r1 = 0;
    const r2 = max * (1 + progress) * 0.6;

    const rect = getRekt(width, height);

    const cx = 0.5 * rect.width;
    const cy = 0.5 * rect.height;

    rect.set(
      'fill',
      new fabric.Gradient({
        type: 'radial',
        coords: {
          r1,
          r2,
          x1: cx,
          y1: cy,
          x2: cx,
          y2: cy,
        },
        colorStops: [
          { offset: 0, color: colors[0] },
          { offset: 1, color: colors[1] },
        ],
      }),
    );

    canvas.add(rect);
  }

  return { onRender };
}

async function linearGradientFrameSource({ width, height, params }) {
  const { colors: inColors } = params;

  const randomColors = getRandomGradient();
  const colors = inColors && inColors.length === 2 ? inColors : randomColors;

  async function onRender(progress, canvas) {
    const rect = getRekt(width, height);

    rect.set(
      'fill',
      new fabric.Gradient({
        coords: {
          x1: 0,
          y1: 0,
          x2: width,
          y2: height,
        },
        colorStops: [
          { offset: 0, color: colors[0] },
          { offset: 1, color: colors[1] },
        ],
      }),
    );

    rect.rotate(progress * 30);
    canvas.add(rect);
  }

  return { onRender };
}

async function subtitleFrameSource({ width, height, params }) {
  const {
    text,
    textColor = '#ffffff',
    backgroundColor = 'rgba(0,0,0,0.3)',
    fontFamily = defaultFontFamily,
    delay = 0,
    speed = 1,
  } = params;

  async function onRender(progress, canvas) {
    const easedProgress = easeOutExpo(
      Math.max(0, Math.min((progress - delay) * speed, 1)),
    );

    const min = Math.min(width, height);
    const padding = 0.05 * min;

    const textBox = new fabric.Textbox(text, {
      fill: textColor,
      fontFamily,

      fontSize: min / 20,
      textAlign: 'left',
      width: width - padding * 2,
      originX: 'center',
      originY: 'bottom',
      left: width / 2 + (-1 + easedProgress) * padding,
      top: height - padding,
      opacity: easedProgress,
    });

    const rect = new fabric.Rect({
      left: 0,
      width,
      height: textBox.height + padding * 2,
      top: height,
      originY: 'bottom',
      fill: backgroundColor,
      opacity: easedProgress,
    });

    canvas.add(rect);
    canvas.add(textBox);
  }

  return { onRender };
}

async function imageOverlayFrameSource({ params, width, height }) {
  const {
    path,
    position,
    width: relWidth,
    height: relHeight,
    zoomDirection,
    zoomAmount = 0.1,
  } = params;

  const imgData = await loadImage(path);

  const { left, top, originX, originY } = getPositionProps({
    position,
    width,
    height,
  });

  const img = new fabric.Image(imgData, {
    originX,
    originY,
    left,
    top,
  });

  let scaleMode = 0; // 0 = none, 1 = width, 2 = height
  if (relHeight && relWidth) {
    const screenRatio = width / height;
    const imageRatio = img.width / img.height;

    const relHIfRelWUsed = (screenRatio / imageRatio) * relWidth;
    const relWIfRelHUsed = (imageRatio / screenRatio) * relHeight;

    // Compare the generated dimension (relXIfRelYUsed) with the user defined limit (if negative, the generated dimension exceeds the user limit)
    const heightDiff = relHeight - relHIfRelWUsed;
    const widthDiff = relWidth - relWIfRelHUsed;

    if (heightDiff > widthDiff) {
      scaleMode = 1;
    } else {
      scaleMode = 2;
    }
  } else if (relWidth) {
    scaleMode = 1;
  } else if (relHeight) {
    scaleMode = 2;
  }

  async function onRender(progress, canvas) {
    const scaleFactor = getZoomParams({ progress, zoomDirection, zoomAmount });

    if (scaleMode === 1) {
      img.scaleToWidth(relWidth * width * scaleFactor);
    } else if (scaleMode === 2) {
      img.scaleToHeight(relHeight * height * scaleFactor);
    } else {
      // Default to screen width
      img.scaleToWidth(width * scaleFactor);
    }

    canvas.add(img);
  }

  return { onRender };
}

async function titleFrameSource({ width, height, params }) {
  const {
    text,
    textColor = '#ffffff',
    fontFamily = defaultFontFamily,
    position = 'center',
    zoomDirection = 'in',
    zoomAmount = 0.2,
  } = params;

  async function onRender(progress, canvas) {
    // console.log('progress', progress);

    const min = Math.min(width, height);

    const fontSize = Math.round(min * 0.1);

    const scaleFactor = getZoomParams({ progress, zoomDirection, zoomAmount });

    const textBox = new fabric.Textbox(text, {
      fill: textColor,
      fontFamily,
      fontSize,
      textAlign: 'center',
      width: width * 0.8,
    });

    // We need the text as an image in order to scale it
    const textImage = await new Promise((r) => textBox.cloneAsImage(r));

    const { left, top, originX, originY } = getPositionProps({
      position,
      width,
      height,
    });

    textImage.set({
      originX,
      originY,
      left,
      top,
      scaleX: scaleFactor,
      scaleY: scaleFactor,
    });
    canvas.add(textImage);
  }

  return { onRender };
}

async function newsTitleFrameSource({ width, height, duration, params }) {
  const {
    text,
    textColor = '#ffffff',
    backgroundColor = '#d02a42',
    fontFamily = defaultFontFamily,
    fontScale = 1,
    delay = 0,
    speed = 1,
    manualTiming = false,
    startTime = 0,
    finishTime = startTime + 3,
    fadeDuration = 1,
    angled = false,
  } = params;

  if (manualTiming && (delay || speed)) {
    console.warn(
      'manual timing is enabled, so delay and speed parameters have no effect',
    );
  } else if (!manualTiming && (startTime, finishTime, fadeDuration)) {
    console.warn(
      'manual timing is disabled, so startTime, fadeDuration, and finishTime have no effect',
    );
  }

  const totalEffectDuration = finishTime - startTime;
  const bgFadeInStartProgress = manualTiming ? startTime / duration : delay;
  const bgFadeOutFinishProgress = finishTime / duration;
  const bgSpeed = manualTiming ? duration / fadeDuration : speed * 3;
  const textSpeed = manualTiming ? bgSpeed * (4 / 3) : speed * 4;

  const min = Math.min(width, height);
  const fontSize = Math.round(min * 0.05) * fontScale;

  const textOutOffset = 0.02 * (totalEffectDuration / duration);
  const manualTextOpacityOffset = 0.07 * (totalEffectDuration / duration);

  const top = height * 0.08;

  // const paddingV = 0.07 * min;
  const paddingV = 0.06 * min;
  // const paddingV = 0.05 * min;
  // const paddingH = 0.03 * min;
  const paddingH = 0.018 * min;

  // TODO: Fix jagged bottom horizontal line (may need to round y values)

  async function onRender(progress, canvas) {
    if (
      !manualTiming
      || (progress > bgFadeInStartProgress && progress < bgFadeOutFinishProgress)
    ) {
      const bgFadeOutLevel = (bgFadeOutFinishProgress - progress) * bgSpeed;
      const textOutLevel = (bgFadeOutFinishProgress - progress - textOutOffset) * bgSpeed;

      const easedBgProgress = manualTiming
        ? clampedEaseOutExpo(
          bgFadeOutLevel > 1
            ? (progress - bgFadeInStartProgress) * bgSpeed
            : bgFadeOutLevel,
        )
        : clampedEaseOutExpo((progress - bgFadeInStartProgress) * bgSpeed);

      const easedTextProgress = manualTiming
        ? clampedEaseOutExpo(
          textOutLevel > 1
            ? (progress - bgFadeInStartProgress - textOutOffset) * textSpeed
            : textOutLevel,
        )
        : clampedEaseOutExpo(
          (progress - bgFadeInStartProgress - 0.02) * textSpeed,
        );

      const easedTextOpacityProgress = manualTiming
        ? clampedEaseOutExpo(
          progress - bgFadeInStartProgress - manualTextOpacityOffset,
        ) * textSpeed // Text does not fade out
        : clampedEaseOutExpo(
          (progress - bgFadeInStartProgress - 0.07) * textSpeed,
        );

      const textBox = new fabric.Text(text, {
        top,
        left: paddingV + (easedTextProgress - 1) * width,
        fill: textColor,
        opacity: easedTextOpacityProgress,
        fontFamily,
        fontSize,
        // charSpacing: width * 0.1,
        charSpacing: width * 0.05,
        // charSpacing: width, // TODO: changed this
      });

      const bgWidth = textBox.width + paddingV * 2;

      if (angled) {
        const plTopY = Math.round(top - paddingH);
        const plBottomY = Math.round(plTopY + (textBox.height + paddingH * 2));
        const plLeftX = 0;
        const plRightX = Math.round(easedBgProgress * bgWidth);

        const polyline = new fabric.Polyline(
          [
            { x: plLeftX, y: plTopY },
            { x: plRightX + width * 0.028, y: plTopY },
            { x: plRightX, y: plBottomY },
            { x: plLeftX, y: plBottomY },
            { x: plLeftX, y: plTopY },
          ],
          {
            fill: backgroundColor,
          },
        );

        // console.log("polyline.points:", polyline.points);
        canvas.add(polyline);
      } else {
        const rect = new fabric.Rect({
          top: top - paddingH,
          left: (easedBgProgress - 1) * bgWidth,
          width: bgWidth,
          height: textBox.height + paddingH * 2,
          fill: backgroundColor,
        });

        canvas.add(rect);
      }
      canvas.add(textBox);
    }
  }

  return { onRender };
}

async function listFrameSource({ width, height, duration, params }) {
  const {
    text,
    textColor = '#ffffff',
    backgroundColor = 'rgba(0,0,0,0.3)',
    fontFamily = defaultFontFamily,
    startTime = 0,
    finishTime = startTime + 10,
    fadeDuration = 3,
    wrapText = false,
    fontScale = 0.038,
    YPos = 0.5,
    YOrigin = 'center',
  } = params;

  console.log('list duration:', duration);
  console.log('list text:', text);
  console.log('startTime:', startTime);
  console.log('finishTime:', finishTime);
  console.log('fadeDuration:', fadeDuration);
  console.log('width:', width);
  console.log('height:', height);

  const maxItems = 11;
  const min = Math.min(width, height);
  const newPaddingV = 0.018 * min;
  // const fontSize = Math.round(min * 0.038);
  const fontSize = Math.round(min * fontScale);
  const leftHPadding = 0.02 * min;
  // const rightHPadding = fontSize * 0.83;
  const rightHPadding = fontSize * 0.82;
  // const rightHPadding = fontSize * 0.8;
  const rightAngledPadding = width * 0.028;

  const truncate = (input) => (input.length > 45 ? `${input.substring(0, 45)}...` : input);

  const getScaler = (numItems, maximumItems, threshold, targetMinimum) => (numItems > threshold
    ? 1
        - (Math.min(numItems, maximumItems) - threshold)
          * ((1 - targetMinimum) / (maximumItems - threshold))
    : 1);

  const createTextBox = (rowText, textTop, textLeft) => new fabric.Text(rowText, {
    top: textTop,
    left: textLeft,
    fill: textColor,
    fontFamily,
    fontSize,
    textAlign: 'left',
    originX: 'left',
    originY: 'center',
  });

  const createPolylineShadow = (mainPl, YOffset) => new fabric.Polyline(
    mainPl.points.map((point) => ({ x: point.x, y: point.y + YOffset })),
    {
      fill: '#000000',
      clipPath: mainPl,
    },
  );

  if (text.length > maxItems) {
    text.splice(maxItems - 1, text.length);
    text.push('  ...   ');
  }

  const sizerTextBox = createTextBox(truncate('a'.repeat(100)), 0, 0);

  console.log('sizerTextBox.text:', sizerTextBox.text);
  console.log('sizerTextBox.width:', sizerTextBox.width);
  console.log('leftHPadding:', leftHPadding);
  console.log('rightHPadding:', rightHPadding);
  console.log('rightAngledPadding:', rightAngledPadding);

  console.log(
    'sizerTextBox.width + leftHPadding + rightHPadding + rightAngledPadding:',
    sizerTextBox.width + leftHPadding + rightHPadding + rightAngledPadding,
  );

  const rowHeight = sizerTextBox.height + newPaddingV * 2;
  const highestY = height / 2 - (rowHeight / 2) * (text.length - 1); // This is for the Y center (not top) of top-most row

  const listItems = text.map((curText, index) => ({
    text: truncate(curText.trim()),
    top: highestY + index * rowHeight, // Y center top
    left: Math.round(
      (width
        - (sizerTextBox.width
          + leftHPadding
          + rightHPadding
          + rightAngledPadding))
        / 2,
    ),
  }));

  // console.log("listItems[0]:", listItems[0]);

  const bgFadeInStartProgress = startTime / duration;
  const bgFadeOutFinishProgress = finishTime / duration;
  const bgOpacitySpeed = duration / (fadeDuration * 0.25); // TODO: may want to only use progressduration (ie 1 / bgOpacityProgressDuration)
  const bgExpansionSpeed = duration / (fadeDuration * 0.75);
  // const staggerScaler = getScaler(text.length, maxItems, 4, 0.6);
  const staggerScaler = getScaler(text.length, maxItems, 4, 0.7);
  const staggerTime = (0.3 / duration) * staggerScaler;

  console.log('startTime:', startTime);
  console.log('finishTime:', finishTime);
  console.log('bgFadeInStartProgress:', bgFadeInStartProgress.toFixed(4));
  console.log('bgFadeOutFinishProgress:', bgFadeOutFinishProgress.toFixed(4));
  console.log('bgOpacitySpeed:', bgOpacitySpeed);
  console.log('stagger Scaler:', staggerScaler);
  console.log('staggerTime:', staggerTime);
  async function onRender(progress, canvas) {
    let lastBottomY;

    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < listItems.length; i++) {
      const item = listItems[i];

      const ItemBgFadeInStartProgress = bgFadeInStartProgress + i * staggerTime;
      const ItemBgFadeOutFinishProgress = bgFadeOutFinishProgress - i * staggerTime;

      const bgFadeOutLevel = (ItemBgFadeOutFinishProgress - progress) * bgOpacitySpeed;
      const bgOpacity = clampedEaseInOutCubic(
        bgFadeOutLevel > 1
          ? (progress - ItemBgFadeInStartProgress) * bgOpacitySpeed
          : bgFadeOutLevel,
      );

      const bgContractionLevel = (ItemBgFadeOutFinishProgress - progress) * bgExpansionSpeed;

      const bgExpansion = bgContractionLevel > 1
        ? 0.05
            + 0.95
              * clampedEaseInOutCubic(
                (progress - ItemBgFadeInStartProgress) * bgExpansionSpeed,
              )
        : 0.05 + 0.95 * clampedEaseInOutCubic(bgContractionLevel);

      clampedEaseInOutCubic(
        bgContractionLevel > 1
          ? (progress - ItemBgFadeInStartProgress) * bgExpansionSpeed
          : bgContractionLevel,
      );

      const textBox = createTextBox(
        item.text,
        item.top,
        item.left + leftHPadding,
        // item.left
      );
      textBox.opacity = bgOpacity;

      const plTopY = lastBottomY === undefined
        ? Math.round(item.top - sizerTextBox.height / 2 - newPaddingV)
        : lastBottomY; // Use lastY to ensure there are no gaps
      const plBottomY = Math.round(plTopY + rowHeight);
      const plLeftX = item.left;
      const plBotRightX = Math.round(
        plLeftX + (textBox.width + leftHPadding + rightHPadding) * bgExpansion,
      );

      const polyline = new fabric.Polyline(
        [
          { x: plLeftX, y: plTopY },
          { x: Math.round(plBotRightX + rightAngledPadding), y: plTopY },
          // { x: plBotRightX, y: plTopY },
          { x: plBotRightX, y: plBottomY },
          { x: plLeftX, y: plBottomY },
        ],
        {
          fill: backgroundColor,
          absolutePositioned: true,
          inverted: true,
          opacity: bgOpacity,
        },
      );

      lastBottomY = plBottomY;
      const plYOffset = (plBottomY - plTopY) * 0.2;
      const polylineUnder = createPolylineShadow(polyline, plYOffset);

      polylineUnder.opacity = bgOpacity;

      textBox.clipPath = new fabric.Polyline(polyline.points, {
        absolutePositioned: true,
      });

      // if (bgOpacity > 0) {
      //   // if (bgExpansion === 1 && i === 0) {
      //   if (bgExpansion === 1) {
      //     console.log("textBox.width:", textBox.width);
      //     console.log(
      //       "poly full width:",
      //       polyline.points[1].x - polyline.points[0].x
      //     );
      //     console.log("plLeftX (item.left):", plLeftX);
      //     console.log("plBotRightX:", plBotRightX);
      //   }
      // }

      canvas.add(polylineUnder);
      canvas.add(polyline);
      canvas.add(textBox);
    }
  }

  return { onRender };
}

async function getFadedObject({ object, progress }) {
  const rect = new fabric.Rect({
    left: 0,
    width: object.width,
    height: object.height,
    top: 0,
  });

  rect.set(
    'fill',
    new fabric.Gradient({
      coords: {
        x1: 0,
        y1: 0,
        x2: object.width,
        y2: 0,
      },
      colorStops: [
        {
          offset: Math.max(0, progress * (1 + 0.2) - 0.2),
          color: 'rgba(255,255,255,1)',
        },
        {
          offset: Math.min(1, progress * (1 + 0.2)),
          color: 'rgba(255,255,255,0)',
        },
      ],
    }),
  );

  const gradientMaskImg = await new Promise((r) => rect.cloneAsImage(r));
  const fadedImage = await new Promise((r) => object.cloneAsImage(r));

  fadedImage.filters.push(
    new fabric.Image.filters.BlendImage({
      image: gradientMaskImg,
      mode: 'multiply',
    }),
  );

  fadedImage.applyFilters();

  return fadedImage;
}

async function slideInTextFrameSource({
  width,
  height,
  params: {
    position,
    text,
    fontSize = 0.05,
    charSpacing = 0.1,
    color = '#ffffff',
    fontFamily = defaultFontFamily,
  } = {},
}) {
  async function onRender(progress, canvas) {
    const fontSizeAbs = Math.round(width * fontSize);

    const { left, top, originX, originY } = getPositionProps({
      position,
      width,
      height,
    });

    const textBox = new fabric.Text(text, {
      fill: color,
      fontFamily,
      fontSize: fontSizeAbs,
      charSpacing: width * charSpacing,
    });

    const { opacity, textSlide } = getFrameByKeyFrames(
      [
        { t: 0.1, props: { opacity: 1, textSlide: 0 } },
        { t: 0.3, props: { opacity: 1, textSlide: 1 } },
        { t: 0.8, props: { opacity: 1, textSlide: 1 } },
        { t: 0.9, props: { opacity: 0, textSlide: 1 } },
      ],
      progress,
    );

    const fadedObject = await getFadedObject({
      object: textBox,
      progress: easeInOutCubic(textSlide),
    });
    fadedObject.setOptions({
      originX,
      originY,
      top,
      left,
      opacity,
    });

    canvas.add(fadedObject);
  }

  return { onRender };
}

async function customFabricFrameSource({ canvas, width, height, params }) {
  return params.func({ width, height, fabric, canvas, params });
}

module.exports = {
  listFrameSource,
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
};
