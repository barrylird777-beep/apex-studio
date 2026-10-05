/**
 * RF propagation calculations for benign link-budget analysis.
 * This module performs no packet capture, radio control, or network access.
 */
const SPEED_OF_LIGHT = 299_792_458;

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${name} must be a finite number greater than zero.`);
  }
  return number;
}

export class RfPropagationAnalyzer {
  calculateFSPL(distanceMeters, frequencyMHz) {
    const distance = finitePositive(distanceMeters, "distanceMeters");
    const frequency = finitePositive(frequencyMHz, "frequencyMHz");
    return Number((
      20 * Math.log10(distance) +
      20 * Math.log10(frequency) +
      27.55
    ).toFixed(2));
  }

  evaluateSignalHealth(rssiDbm) {
    const rssi = Number(rssiDbm);
    if (!Number.isFinite(rssi)) throw new TypeError("rssiDbm must be finite.");
    if (rssi >= -60) return { zone: "OPTIMAL", description: "Strong estimated received level under the supplied model." };
    if (rssi >= -80) return { zone: "MARGINAL", description: "Moderate estimated received level; real-world fading may matter." };
    return { zone: "NOISE_FLOOR", description: "Weak estimated received level; reliable communication may be difficult." };
  }

  estimateSignalPath(params = {}) {
    const {
      txPowerDbm = 20,
      txAntennaGainDbi = 3,
      rxAntennaGainDbi = 3,
      distanceMeters = 50,
      frequencyMHz = 2412
    } = params;

    const txPower = Number(txPowerDbm);
    const txGain = Number(txAntennaGainDbi);
    const rxGain = Number(rxAntennaGainDbi);
    if (![txPower, txGain, rxGain].every(Number.isFinite)) {
      throw new TypeError("Power and antenna gains must be finite numbers.");
    }

    const distance = finitePositive(distanceMeters, "distanceMeters");
    const frequency = finitePositive(frequencyMHz, "frequencyMHz");
    const fspl = this.calculateFSPL(distance, frequency);
    const estimatedRssi = txPower + txGain + rxGain - fspl;
    const health = this.evaluateSignalHealth(estimatedRssi);

    return {
      distanceMeters: distance,
      frequencyMHz: frequency,
      wavelengthMeters: Number((SPEED_OF_LIGHT / (frequency * 1e6)).toFixed(6)),
      fsplDb: fspl,
      estimatedRssiDbm: Number(estimatedRssi.toFixed(2)),
      healthZone: health.zone,
      description: health.description
    };
  }
}

export default RfPropagationAnalyzer;

if (import.meta.url === `file://${process.argv[1]}`) {
  const analyzer = new RfPropagationAnalyzer();
  for (const distanceMeters of [10, 50, 100, 250]) {
    const report = analyzer.estimateSignalPath({ distanceMeters, frequencyMHz: 2412 });
    console.log(`Distance: ${distanceMeters}m | FSPL: ${report.fsplDb} dB | Estimated RSSI: ${report.estimatedRssiDbm} dBm | Zone: ${report.healthZone}`);
  }
}
