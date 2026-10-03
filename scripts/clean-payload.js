import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function cleanAndProcessDataset(inputFileName) {
  const inputPath = path.join(__dirname, "../data/payloads", inputFileName);
  const outputPath = path.join(__dirname, "../data/payloads", `cleaned-${inputFileName}`);

  console.log(`[START] Ingesting raw dataset: ${inputFileName}`);

  try {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Target file missing at: ${inputPath}`);
    }

    const rawData = fs.readFileSync(inputPath, "utf-8");
    const jsonData = JSON.parse(rawData);

    if (jsonData === null || typeof jsonData !== "object" || Array.isArray(jsonData)) {
      throw new Error("Expected the dataset root to be a JSON object");
    }

    const cleanedData = Object.keys(jsonData).reduce((acc, key) => {
      if (jsonData[key] !== null && jsonData[key] !== undefined) {
        acc[key.trim()] =
          typeof jsonData[key] === "string" ? jsonData[key].trim() : jsonData[key];
      }
      return acc;
    }, {});

    fs.writeFileSync(outputPath, JSON.stringify(cleanedData, null, 2) + "\n");
    console.log(`[SUCCESS] Dataset cleaned and saved to: cleaned-${inputFileName}`);
  } catch (error) {
    console.error(`[CRITICAL] Data validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

cleanAndProcessDataset("sample-target.json");
