import { Dither } from "ditherwave";
import coastUrl from "../assets/coast.webp";

const INKS = [
  "#526139",
  "#3B747A",
  "#2A9CC4",
  "#5DAEDE",
  "#DEB05F",
  "#C6BBAA",
  "#ABCADE",
  "#E0E0E0",
];

// Dither puts position: relative inline on its wrapper; this fills the slot instead.
const FILL = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;

export function CoastField() {
  const photo = <img className="shore-field-photo" src={coastUrl} alt="" />;

  return (
    <Dither
      className="shore-field"
      style={FILL}
      mode="bayer"
      matrixSize={4}
      resolution={720}
      palette={INKS}
      intensity={0.72}
      contrast={1.2}
      animate={false}
      fallback={photo}
    >
      {photo}
    </Dither>
  );
}
