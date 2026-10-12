import MarketingNav from "./MarketingNav";
import InstallAppSection from "./InstallAppSection";
import { usePageMeta } from "./MarketingHome";

export default function InstallPage() {
  usePageMeta(
    "Κατέβασε το BookEasy",
    "Το BookEasy λειτουργεί καλύτερα μέσα στην εφαρμογή."
  );
  return (
    <div className="mk-page">
      <MarketingNav />
      <InstallAppSection
        title="Κατέβασε το BookEasy"
        text="Το BookEasy λειτουργεί καλύτερα μέσα στην εφαρμογή."
        comingSoonText="en"
      />
    </div>
  );
}
