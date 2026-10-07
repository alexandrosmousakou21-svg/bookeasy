# Phase 2: Marketing Website Implementation Plan

**Status:** Planning Document (No Code Changes Yet)  
**Scope:** Website transformation to marketing site + install app CTA  
**Duration:** 2-3 weeks of development  
**Branch:** `docs/architecture-audit`

---

## ✅ Implementation Files to Create

Once approved, you will create these files in `src/`:

### New Components:

```
src/components/
├── MarketingNav.jsx              (Top navigation)
├── HeroSection.jsx               (Hero banner)
├── ProfessionalsSection.jsx       (Benefits for professionals)
├── CustomersSection.jsx           (Benefits for customers)
├── AISection.jsx                 (AI capabilities)
├── NotificationsSection.jsx       (Notifications feature)
├── PricingSection.jsx             (Pricing plans display)
├── FAQSection.jsx                 (FAQ accordion)
├── InstallAppSection.jsx          (Reusable install CTA)
├── FooterCTA.jsx                 (Final call-to-action)
└── MarketingLayout.jsx           (Wrapper layout)

src/pages/
├── MarketingHome.jsx             (Main landing page)
└── InstallPage.jsx               (Dedicated /install page)

src/utils/
└── deviceDetection.js            (Platform detection utility)
```

### Files to Modify:

```
src/App.jsx                        (Add new routes)
index.html                         (Update meta tags)
src/styles.css                     (Add marketing styles)
.env.example                       (Add env variables)
```

---

## 🔧 Device Detection Utility

**File:** `src/utils/deviceDetection.js`

```javascript
export function detectDevice() {
  const ua = navigator.userAgent;
  
  return {
    isIOS: /iPad|iPhone|iPod/.test(ua),
    isAndroid: /Android/.test(ua),
    isDesktop: !/iPad|iPhone|iPod|Android/.test(ua),
    isMobile: /iPad|iPhone|iPod|Android/.test(ua)
  };
}

export function getPrimaryStoreUrl() {
  const { isIOS, isAndroid } = detectDevice();
  
  if (isIOS) {
    return import.meta.env.VITE_IOS_STORE_URL || null;
  }
  if (isAndroid) {
    return import.meta.env.VITE_ANDROID_STORE_URL || null;
  }
  return null;
}

export function getSecondaryStoreUrl() {
  const { isDesktop } = detectDevice();
  
  if (isDesktop) {
    return {
      ios: import.meta.env.VITE_IOS_STORE_URL,
      android: import.meta.env.VITE_ANDROID_STORE_URL
    };
  }
  return null;
}
```

---

## 📱 Install App Section Component

**File:** `src/components/InstallAppSection.jsx`

```javascript
import { ChevronRight } from 'lucide-react';
import { detectDevice, getPrimaryStoreUrl, getSecondaryStoreUrl } from '../utils/deviceDetection';

export function InstallAppSection() {
  const { isIOS, isAndroid, isDesktop } = detectDevice();
  const primaryUrl = getPrimaryStoreUrl();
  const secondaryUrls = getSecondaryStoreUrl();

  return (
    <section className="install-app-section">
      <div className="install-app-container">
        <div className="install-app-content">
          <h2>Κατέβασε το BookEasy App</h2>
          <p>Το BookEasy λειτουργεί καλύτερα μέσα στην εφαρμογή.</p>
        </div>

        <div className="install-app-buttons">
          {isIOS && (
            <>
              {primaryUrl ? (
                <a href={primaryUrl} className="primary-button app-store-button">
                  Download on the App Store
                </a>
              ) : (
                <button className="primary-button app-store-button" disabled>
                  Σύντομα στο App Store
                </button>
              )}
              
              {import.meta.env.VITE_ANDROID_STORE_URL ? (
                <a 
                  href={import.meta.env.VITE_ANDROID_STORE_URL} 
                  className="secondary-button google-play-button"
                >
                  Get it on Google Play
                </a>
              ) : (
                <button className="secondary-button google-play-button" disabled>
                  Σύντομα στο Google Play
                </button>
              )}
            </>
          )}

          {isAndroid && (
            <>
              {primaryUrl ? (
                <a href={primaryUrl} className="primary-button google-play-button">
                  Get it on Google Play
                </a>
              ) : (
                <button className="primary-button google-play-button" disabled>
                  Σύντομα στο Google Play
                </button>
              )}
              
              {import.meta.env.VITE_IOS_STORE_URL ? (
                <a 
                  href={import.meta.env.VITE_IOS_STORE_URL} 
                  className="secondary-button app-store-button"
                >
                  Download on the App Store
                </a>
              ) : (
                <button className="secondary-button app-store-button" disabled>
                  Σύντομα στο App Store
                </button>
              )}
            </>
          )}

          {isDesktop && (
            <>
              {import.meta.env.VITE_IOS_STORE_URL ? (
                <a 
                  href={import.meta.env.VITE_IOS_STORE_URL} 
                  className="primary-button app-store-button"
                >
                  Download on the App Store
                </a>
              ) : (
                <button className="primary-button app-store-button" disabled>
                  Σύντομα στο App Store
                </button>
              )}
              
              {import.meta.env.VITE_ANDROID_STORE_URL ? (
                <a 
                  href={import.meta.env.VITE_ANDROID_STORE_URL} 
                  className="primary-button google-play-button"
                >
                  Get it on Google Play
                </a>
              ) : (
                <button className="primary-button google-play-button" disabled>
                  Σύντομα στο Google Play
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
```

---

## 🏠 Marketing Home Page Structure

**File:** `src/pages/MarketingHome.jsx`

```javascript
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { HeroSection } from '../components/HeroSection';
import { ProfessionalsSection } from '../components/ProfessionalsSection';
import { CustomersSection } from '../components/CustomersSection';
import { AISection } from '../components/AISection';
import { NotificationsSection } from '../components/NotificationsSection';
import { PricingSection } from '../components/PricingSection';
import { FAQSection } from '../components/FAQSection';
import { InstallAppSection } from '../components/InstallAppSection';
import { FooterCTA } from '../components/FooterCTA';
import { MarketingLayout } from '../components/MarketingLayout';

export function MarketingHome() {
  return (
    <MarketingLayout>
      <main className="marketing-home">
        <HeroSection />
        <ProfessionalsSection />
        <CustomersSection />
        <AISection />
        <NotificationsSection />
        <PricingSection />
        <FAQSection />
        <InstallAppSection />
        <FooterCTA />
      </main>
    </MarketingLayout>
  );
}
```

---

## 📍 Environment Variables

**File:** `.env.example`

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# App Store URLs (leave empty if not published)
VITE_ANDROID_STORE_URL=https://play.google.com/store/apps/details?id=com.bookeasy.app
VITE_IOS_STORE_URL=https://apps.apple.com/app/bookeasy/id...

# Or during development:
# VITE_ANDROID_STORE_URL=
# VITE_IOS_STORE_URL=
```

---

## 🔀 Routes to Add to App.jsx

```javascript
import { MarketingHome } from './pages/MarketingHome';
import { InstallPage } from './pages/InstallPage';

// Inside <Routes>:
<Route path="/" element={<MarketingHome />} />
<Route path="/install" element={<InstallPage />} />

// Keep all existing routes:
<Route path="/b/:slug" element={<CustomerBooking />} />
<Route path="/book/:slug" element={<CustomerBooking />} />
<Route path="/customer" element={<CustomerHome />} />
<Route path="/customer-login" element={<CustomerAuthRedirect mode="login" />} />
<Route path="/customer-register" element={<CustomerAuthRedirect mode="register" />} />
<Route path="/customer/profile" element={<CustomerProfile />} />
<Route path="/my-appointments" element={<CustomerAppointmentsPage />} />
<Route path="/login" element={<AuthPage mode="login" />} />
<Route path="/register" element={<AuthPage mode="register" />} />
<Route path="/dashboard/*" element={<Protected><Dashboard /></Protected>} />
```

---

## 📄 Meta Tags Update

**File:** `index.html`

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#5A4638" />
  
  <!-- SEO -->
  <title>BookEasy — Online κρατήσεις για επαγγελματίες</title>
  <meta name="description" content="Το BookEasy οργανώνει κρατήσεις, πελάτες, υπηρεσίες και ραντεβού. Κατέβασε την εφαρμογή για επαγγελματίες και πελάτες." />
  
  <!-- Open Graph -->
  <meta property="og:title" content="BookEasy — Online κρατήσεις" />
  <meta property="og:description" content="Όλες οι κρατήσεις σου. Σε ένα app." />
  <meta property="og:type" content="website" />
  
  <!-- Mobile Web App -->
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="BookEasy" />
  
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/icons/icon-192.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
</head>
```

---

## 🎨 CSS Classes Structure

**File:** `src/styles.css` (additions)

```css
/* Marketing Layout */
.marketing-home {
  background: var(--cream, #F6EFE6);
  color: var(--ink, #5A4638);
}

.marketing-section {
  padding: 48px 16px;
  max-width: 1200px;
  margin: 0 auto;
}

@media (min-width: 768px) {
  .marketing-section {
    padding: 64px 24px;
  }
}

/* Hero Section */
.hero-section {
  text-align: center;
  padding: 64px 16px;
  background: linear-gradient(180deg, #EDE2D6 0%, #F6EFE6 100%);
}

.hero-section h1 {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 16px;
  line-height: 1.2;
}

.hero-section p {
  font-size: 1.1rem;
  margin-bottom: 32px;
  opacity: 0.8;
}

/* Install App Section */
.install-app-section {
  background: var(--navy, #5A4638);
  color: white;
  padding: 48px 16px;
  text-align: center;
}

.install-app-container {
  max-width: 600px;
  margin: 0 auto;
}

.install-app-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 24px;
}

@media (min-width: 768px) {
  .install-app-buttons {
    flex-direction: row;
    justify-content: center;
  }
}

/* App Store Buttons */
.app-store-button,
.google-play-button {
  padding: 14px 24px;
  border-radius: 8px;
  font-weight: 600;
  text-decoration: none;
  display: inline-block;
  transition: all 0.3s ease;
}

.app-store-button {
  background: white;
  color: #5A4638;
  border: 1px solid white;
}

.app-store-button:hover {
  opacity: 0.9;
}

.google-play-button {
  background: transparent;
  color: white;
  border: 2px solid white;
}

.google-play-button:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Disabled state */
button[disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Navigation */
.marketing-nav {
  background: var(--navy, #5A4638);
  color: white;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.marketing-nav a {
  color: white;
  text-decoration: none;
  margin: 0 16px;
  font-size: 0.95rem;
}

.marketing-nav a:hover {
  opacity: 0.8;
}

/* FAQ */
.faq-item {
  margin-bottom: 16px;
  border-bottom: 1px solid #E4D5C7;
  padding-bottom: 16px;
}

.faq-item button {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.faq-item.open .faq-answer {
  display: block;
}

.faq-answer {
  display: none;
  margin-top: 12px;
  color: #806B5B;
}
```

---

## 📋 Components Specification

### HeroSection.jsx
```
- BookEasy logo/brand
- Headline: "Όλες οι κρατήσεις σου. Σε ένα app."
- Subheading: "Για επαγγελματίες και πελάτες"
- Primary button: "Κατέβασε το BookEasy App"
- Secondary button: "Δες πώς λειτουργεί"
```

### ProfessionalsSection.jsx
```
- Title: "Για Επαγγελματίες"
- Features with icons:
  ✓ Online Κρατήσεις
  ✓ Ημερολόγιο & Ραντεβού
  ✓ Πελάτες
  ✓ Υπηρεσίες
  ✓ Προσωπικό
  ✓ Ωράριο Λειτουργίας
  ✓ Γνωστοποιήσεις
  ✓ AI Υπηρέτηση Πελατών
  ✓ Σχέδια & Υπογραφές
- CTA: "Ξεκίνησε τώρα"
```

### CustomersSection.jsx
```
- Title: "Για Πελάτες"
- Features with icons:
  ✓ Ανακαλύψτε Επιχειρήσεις
  ✓ Κλείστε Ραντεβού
  ✓ Διαχειριστείτε τα Ραντεβού σας
  ✓ Λάβετε Ειδοποιήσεις
  ✓ Επικοινωνία
- CTA: "Ξεκίνησε την αναζήτηση"
```

### AISection.jsx
```
- Icon: Sparkles
- Title: "Το BookEasy AI"
- Description of AI assistant capability
- Features: 24/7 responses, business info, smart replies
```

### NotificationsSection.jsx
```
- Icon: Bell
- Title: "Ειδοποιήσεις & Υπενθυμίσεις"
- Description: "Κανένο ραντεβού δεν χάνεται ποτέ"
- Features: Booking confirmation, changes, reminders
```

### PricingSection.jsx
```
- Title: "Σχέδια & Τιμές"
- Display existing plans (don't create new Stripe logic)
- Basic plan details
- Plus plan details
- Note: "Οι πελάτες δεν πληρώνουν"
- CTA: "Ξεκίνησε"
```

### FAQSection.jsx
```
- Accordion with 6-8 questions
- Q: "Τι είναι το BookEasy;"
- Q: "Ποιο κόστος έχει;"
- Q: "Πώς κλείνω ραντεβού;"
- Q: "Πώς λαμβάνω ειδοποιήσεις;"
- Q: "Πώς διαχειρίζω τα ραντεβού;"
- Q: "Πώς ακυρώνω ραντεβού;"
```

### MarketingNav.jsx
```
- Logo: BookEasy
- Links:
  • Αρχική
  • Πώς λειτουργεί
  • Για επαγγελματίες
  • Για πελάτες
  • Τιμές
  • FAQ
  • Εγκατάσταση App
- Primary CTA: "Κατέβασε το App"
- Mobile: Hamburger menu
```

### InstallPage.jsx
```
- Title: "Κατέβασε το BookEasy"
- Explanation: "Το BookEasy λειτουργεί καλύτερα στην εφαρμογή"
- InstallAppSection component
- No fake URLs
- "Coming Soon" if not configured
```

---

## ✅ Acceptance Criteria

- ✅ Marketing home page live and responsive
- ✅ All 8 sections visible and properly formatted
- ✅ Device detection working (iOS/Android/Desktop)
- ✅ Install app buttons show/hide based on environment variables
- ✅ `/install` page created and working
- ✅ Public booking (`/b/:slug`, `/book/:slug`) unchanged
- ✅ Navigation complete with all items
- ✅ Mobile-first responsive design
- ✅ No new UI frameworks introduced
- ✅ No fake app store URLs used
- ✅ Meta tags updated for SEO
- ✅ No breaking changes to existing routes
- ✅ Dashboard routes still functional

---

## 🚫 Do NOT Do

❌ Create `/app/dashboard` routes  
❌ Delete existing routes  
❌ Modify Supabase logic  
❌ Change Stripe implementation  
❌ Modify AI assistant  
❌ Force app downloads  
❌ Use fake URLs  
❌ Introduce new frameworks  
❌ Break authentication  
❌ Delete customer booking  
❌ Deploy or commit yet  

---

## 📱 Easy Copy on iOS

**To access on your iOS device:**
1. Open GitHub app
2. Navigate to: `alexandrosmousakou21-svg/bookeasy`
3. Switch to branch: `docs/architecture-audit`
4. Open this file: `docs/PHASE-2-MARKETING-IMPLEMENTATION.md`
5. Tap "Select All" → Copy
6. Paste into Notes, Notion, or email

---

**Status:** Ready for Implementation Approval  
**Next:** Code implementation (when approved)
