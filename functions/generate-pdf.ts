import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renderCharacterSheet } from "../src/renderer.ts";

import chromium from "@sparticuz/chromium-min";
import puppeteer from "puppeteer-core";

// Conditionally import puppeteer based on environment
const isServerless =
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// Security configuration
const MAX_PAYLOAD_SIZE = 500 * 1024; // 500KB
const MAX_CHARACTERS = 100;
const ALLOWED_ORIGIN = "https://fancy.ravenswoodstudio.xyz";

// Optional API key for additional security (set in Vercel environment variables)
const API_KEY = process.env.PDF_API_KEY;

interface PDFRequest {
  script: any; // BotC script JSON
  options: {
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
  };
  filename?: string;
}

async function getBrowser() {
  if (isServerless) {
    return puppeteer.launch({
      args: [...chromium.args, "--hide-scrollbars", "--disable-web-security"],
      executablePath: await chromium.executablePath(
        `https://github.com/Sparticuz/chromium/releases/download/v141.0.0/chromium-v141.0.0-pack.x64.tar`
      ),
      headless: "shell",
      ignoreHTTPSErrors: true,
    });
  } else {
    // Local: Full Puppeteer with bundled Chrome
    const puppeteerModule = await import("puppeteer");
    const puppeteer = puppeteerModule.default;

    return puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-web-security",
      ],
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers for all responses
  const origin = req.headers.origin;
  const isAllowedOrigin =
    origin &&
    (origin.includes(ALLOWED_ORIGIN) ||
      origin.includes("localhost") ||
      origin.includes("127.0.0.1"));

  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  }

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Check origin
  if (origin && !isAllowedOrigin) {
    return res.status(403).json({ error: "Forbidden: Invalid origin" });
  }

  // Optional API key check
  if (API_KEY && req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid API key" });
  }

  try {
    // Validate payload size
    const payloadSize = JSON.stringify(req.body).length;
    if (payloadSize > MAX_PAYLOAD_SIZE) {
      return res.status(413).json({
        error: `Payload too large. Maximum size is ${
          MAX_PAYLOAD_SIZE / 1024
        }KB`,
      });
    }

    const { script, options, filename } = req.body as PDFRequest;

    // Validate required fields
    if (!script || !Array.isArray(script)) {
      return res.status(400).json({ error: "Invalid script format" });
    }

    // Validate character count
    const characterCount = script.filter(
      (el: any) =>
        typeof el === "string" || (typeof el === "object" && el.id !== "_meta")
    ).length;

    if (characterCount > MAX_CHARACTERS) {
      return res.status(400).json({
        error: `Too many characters. Maximum is ${MAX_CHARACTERS}`,
      });
    }

    // Generate HTML with the character sheet
    console.log("script:", script);
    const html = renderCharacterSheet(script, options || {});

    // Load appropriate puppeteer version
    const executablePath = "/var/task/node_modules/@sparticuz/chromium/bin";

    // Debug: Check filesystem in production
    if (isServerless) {
      const fs = await import("fs");
      console.log("=== Filesystem Debug ===");
      console.log(
        "/tmp contents:",
        fs.existsSync("/tmp") ? fs.readdirSync("/tmp") : "does not exist"
      );
      console.log("Current directory:", process.cwd());
      console.log("Current directory contents:", fs.readdirSync(process.cwd()));
      console.log("node_modules exists:", fs.existsSync("node_modules"));
      if (fs.existsSync("node_modules/@sparticuz")) {
        console.log(
          "@sparticuz contents:",
          fs.readdirSync("node_modules/@sparticuz")
        );
        if (fs.existsSync("node_modules/@sparticuz/chromium")) {
          console.log(
            "chromium package contents:",
            fs.readdirSync("node_modules/@sparticuz/chromium")
          );
        }
      }
      if (fs.existsSync(executablePath)) {
        console.log("Executable Path Exists");
      }
    }

    // Launch Puppeteer with appropriate settings for environment
    const browser = await getBrowser();

    const page = await browser.newPage();

    page.on("request", (request) => {
      console.log("request:", request.url());
    });

    page.on("response", (response) => {
      console.log("response:", response.url(), response.status());
    });

    page.on("requestfailed", (request) => {
      console.log(request.url() + " " + request.failure()?.errorText);
    });

    // Set content and wait for fonts/images to load
    await page.setContent(html, {
      waitUntil: ["networkidle0", "load"],
    });

    // Generate PDF
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      preferCSSPageSize: true,
      waitForFonts: true,
    });

    await browser.close();

    // Set response headers
    const pdfFilename = filename || "script.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${pdfFilename}"`
    );
    res.setHeader("Content-Length", pdf.length);

    // Send PDF
    res.status(200).send(pdf);
  } catch (error) {
    console.error("PDF generation error:", error);
    res.status(500).json({
      error: "Failed to generate PDF",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
