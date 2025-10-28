import { h } from "preact";
import render from "preact-render-to-string";
import { CharacterSheet, SheetBack } from "botc-character-sheet";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// Import parsing utilities (we'll need to copy these or create minimal versions)
import {
  parseScript,
  groupCharactersByTeam,
  findJinxes,
} from "./scriptUtils";

interface RenderOptions {
  color?: string;
  showAuthor?: boolean;
  showJinxes?: boolean;
  useOldJinxes?: boolean;
  showSwirls?: boolean;
  includeMargins?: boolean;
  solidTitle?: boolean;
  iconScale?: number;
  compactAppearance?: boolean;
  showBackingSheet?: boolean;
}

// Determine base URL for assets based on environment
const isLocal = !process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME;
const ASSET_BASE = isLocal
  ? "http://localhost:5173" // Frontend dev server for local development
  : "https://fancy.ravenswoodstudio.xyz"; // GitHub Pages for production

// Load CSS from the character-sheet package
function loadCSS(): string {
  try {
    // Try multiple possible paths for CSS
    // Working directory is: /Users/.../script-pdf-maker/packages/backend
    const possiblePaths = [
      // Workspace path (from backend directory - LOCAL DEV)
      join(process.cwd(), "../character-sheet/dist/style.css"),
      // node_modules path (Vercel deployment)
      join(process.cwd(), "node_modules/botc-character-sheet/dist/style.css"),
      // Absolute from monorepo root
      join(process.cwd(), "../../packages/character-sheet/dist/style.css"),
    ];

    for (const cssPath of possiblePaths) {
      try {
        const css = readFileSync(cssPath, "utf-8");
        console.log(`✓ Loaded CSS from: ${cssPath}`);
        return css;
      } catch (err) {
        console.log(`✗ Failed to load from: ${cssPath}`);
        // Try next path
        continue;
      }
    }

    throw new Error("CSS file not found in any expected location");
  } catch (error) {
    console.error("Failed to load CSS:", error);
    console.error("Working directory:", process.cwd());
    return "";
  }
}

// Load fonts from asset base (localhost or GitHub Pages)
function getFontFaces(): string {
  console.log(`Loading fonts from: ${ASSET_BASE}`);
  return `
    @font-face {
      font-family: 'Unlovable';
      src: url('${ASSET_BASE}/fonts/LHF_Unlovable.ttf') format('truetype');
      font-weight: normal;
      font-style: normal;
    }
    @font-face {
      font-family: 'Dumbledor';
      src: url('${ASSET_BASE}/fonts/Dumbledor/Dumbledor.ttf') format('truetype');
      font-weight: normal;
      font-style: normal;
    }
    @font-face {
      font-family: 'Trade Gothic';
      src: url('${ASSET_BASE}/fonts/TradeGothic/TradeGothic.otf') format('opentype');
      font-weight: normal;
      font-style: normal;
    }
    @font-face {
      font-family: 'Goudy Old Style';
      src: url("${ASSET_BASE}/fonts/GoudyOldStyle/GoudyOldStyleBold.ttf");
    }
  `;
}

export function renderCharacterSheet(
  scriptJson: any,
  options: RenderOptions = {}
): string {
  const {
    color = "#137415",
    showAuthor = true,
    showJinxes = true,
    useOldJinxes = false,
    showSwirls = true,
    includeMargins = false,
    solidTitle = false,
    iconScale = 1.6,
    compactAppearance = false,
    showBackingSheet = true,
  } = options;

  // Parse the script
  const script = parseScript(scriptJson);
  const groupedCharacters = groupCharactersByTeam(script.characters);
  const jinxes = showJinxes
    ? findJinxes(script.characters, scriptJson, useOldJinxes)
    : [];

  // Render CharacterSheet component to HTML string
  const characterSheetHtml = render(
    h(CharacterSheet, {
      title: script.metadata?.name || "Custom Script",
      author: showAuthor ? script.metadata?.author : undefined,
      characters: groupedCharacters,
      color,
      jinxes,
      showSwirls,
      includeMargins,
      solidTitle,
      iconScale,
      compactAppearance,
    })
  );

  // Render SheetBack if requested
  const sheetBackHtml = showBackingSheet
    ? render(
        h(SheetBack, {
          title: script.metadata?.name || "Custom Script",
          color,
          includeMargins,
        })
      )
    : "";

  // Load CSS
  const css = loadCSS();
  const fontFaces = getFontFaces();

  // Replace relative image URLs with absolute URLs pointing to asset base
  console.log(`Loading images from: ${ASSET_BASE}`);
  const processedCss = css
    .replace(/url\(\/images\//g, `url(${ASSET_BASE}/images/`)
    .replace(/url\("\/images\//g, `url("${ASSET_BASE}/images/`)
    .replace(/url\('\/images\//g, `url('${ASSET_BASE}/images/`);

  // Also fix image src attributes in the rendered HTML
  const processedCharacterSheetHtml = characterSheetHtml
    .replace(/src="\/images\//g, `src="${ASSET_BASE}/images/`)
    .replace(/src='\/images\//g, `src='${ASSET_BASE}/images/`);

  const processedSheetBackHtml = sheetBackHtml
    .replace(/src="\/images\//g, `src="${ASSET_BASE}/images/`)
    .replace(/src='\/images\//g, `src='${ASSET_BASE}/images/`);

  // Create complete HTML document
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Character Sheet PDF</title>
  <style>
    ${fontFaces}

    * {
      box-sizing: border-box;
    }

    body {
      margin: 10mm;
      padding: 10mm;
      background: white;
    }

    .sheet-wrapper {
      display: flex;
      flex-direction: column;
      page-break-inside: avoid;
    }

    @page { size: A4 portrait; margin: 0; }

    @media print {
      html {
        visibility: hidden;
      }

      .sheet-wrapper {
        visibility: visible;
        position: absolute;
        left: 0;
        top: 0;
      }
    }


    ${processedCss}
  </style>
</head>
<body>
  <div class="sheet-wrapper">
    ${processedCharacterSheetHtml}
    <div style="break-after:page;"></div>
    ${processedSheetBackHtml}
  </div>
</body>
</html>
  `;

  writeFileSync("debug-character-sheet.html", html, "utf-8");

  return html;
}
