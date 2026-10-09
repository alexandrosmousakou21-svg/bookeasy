import { getStoreLinks } from "../utils/deviceDetection";

const LABELS = {
  ios: {
    live: "Download on the App Store",
    soon: "Σύντομα στο App Store",
    soonEn: "Coming soon",
  },
  android: {
    live: "Get it on Google Play",
    soon: "Σύντομα στο Google Play",
    soonEn: "Coming soon",
  },
};

function StoreButton({ store, primary, comingSoonText }) {
  const labels = LABELS[store.id];
  const cls = primary ? "primary-button" : "outline-button";
  if (store.url) {
    return (
      <a
        className={cls}
        href={store.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {labels.live}
      </a>
    );
  }
  return (
    <span className={cls} aria-disabled="true" style={{ opacity: 0.7 }}>
      {comingSoonText === "en" ? labels.soonEn : labels.soon}
    </span>
  );
}

export default function InstallAppSection({
  title = "Κατέβασε το BookEasy App",
  text = "Το BookEasy λειτουργεί καλύτερα μέσα στην εφαρμογή.",
  comingSoonText = "el",
  id,
}) {
  const { device, primary, secondary } = getStoreLinks();
  return (
    <section className="mk-install" id={id}>
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="mk-buttons">
        <StoreButton
          store={primary}
          primary
          comingSoonText={comingSoonText}
        />
        <StoreButton
          store={secondary}
          primary={false}
          comingSoonText={comingSoonText}
        />
      </div>
      {device === "desktop" && (
        <small>Download the BookEasy App για iOS και Android.</small>
      )}
    </section>
  );
}
