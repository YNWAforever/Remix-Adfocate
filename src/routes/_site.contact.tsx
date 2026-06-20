import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Send,
  CheckCircle2,
  Building2,
  User,
  Wallet,
  Store,
  Users,
} from "lucide-react";
import { legacyContact } from "@/data/legacyAdfocateContent";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/contact")({
  component: ContactPage,
});

type TabId = "brand" | "creator" | "adfoplace" | "capital" | "partner";

const tabs: { id: TabId; label: string; icon: typeof Building2 }[] = [
  { id: "brand", label: "Brand Enquiry", icon: Building2 },
  { id: "creator", label: "Creator Signup", icon: User },
  { id: "adfoplace", label: "Adfoplace Offer", icon: Store },
  { id: "capital", label: "Capital Waitlist", icon: Wallet },
  { id: "partner", label: "Partner Enquiry", icon: Users },
];

const campaignInterests = [
  "KOL Awareness Campaign",
  "KOC Product Trial",
  "Affiliate Influencer Program",
  "Short-Form Video Sprint",
  "Live Commerce Campaign",
  "Event Creator Coverage",
  "Always-On Creator Program",
  "Adfoplace Offer Launch",
  "Creator Growth Pool Setup",
  "Not sure — need advice",
];

const budgetRanges = ["< HK$30k", "HK$30k–100k", "HK$100k–300k", "HK$300k–500k", "HK$500k+"];

const markets = [
  "Hong Kong",
  "Macau",
  "Taiwan",
  "Greater China",
  "Southeast Asia",
  "Other APAC",
  "Global",
];

const mainCategories = [
  "Beauty",
  "Food",
  "Travel",
  "Fashion",
  "Lifestyle",
  "Wellness",
  "Finance",
  "Parenting",
  "Tech",
  "Other",
];

const selfSelectLevels = [
  "Shopper (L0)",
  "KOC Starter (L1)",
  "Trusted KOC (L2)",
  "Nano Creator (L3)",
  "Micro-Influencer (L4)",
  "Influencer (L5)",
  "Creator Entrepreneur (L6)",
];

const incomeStreams = [
  "Campaign fees",
  "Affiliate commission",
  "UGC content jobs",
  "Live commerce",
  "Product drops",
  "Ambassador retainers",
  "Other",
];

const submitToastMessage = `Thanks! This preview form has recorded your interest locally. For live enquiries, email ${legacyContact.email}.`;

function ContactPage() {
  const [activeTab, setActiveTab] = useState<TabId>("brand");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    toast.success(submitToastMessage);
  };

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    setSubmitted(false);
  };

  return (
    <div>
      <HeroSection />
      <FormSection
        activeTab={activeTab}
        switchTab={switchTab}
        submitted={submitted}
        handleSubmit={handleSubmit}
        setSubmitted={setSubmitted}
      />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-8 pb-8 sm:pt-20 sm:pb-14">
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(255,181,194,0.15) 0%, transparent 65%)",
          }}
        />
        <div
          className="absolute bottom-0 -left-32 w-[400px] h-[400px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(167,243,208,0.12) 0%, transparent 65%)",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <span className="inline-block font-mono text-[10px] uppercase tracking-[0.2em] text-brand-pink border-2 border-brand-pink/30 rounded-full px-3 py-1.5 bg-white mb-6">
            Contact
          </span>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl text-foreground max-w-3xl leading-[1.05] mb-5">
            Let's talk about your campaign<span className="text-brand-pink">.</span>
          </h1>
          <p className="text-soft-ink text-sm sm:text-base max-w-xl leading-relaxed">
            Choose the right form below for campaign planning, creator signup, Adfoplace offers,
            capital interest, or partnerships. For live enquiries, email{" "}
            <a
              href={`mailto:${legacyContact.email}`}
              className="font-bold text-brand-pink hover:underline"
            >
              {legacyContact.email}
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

function FormSection({
  activeTab,
  switchTab,
  submitted,
  handleSubmit,
  setSubmitted,
}: {
  activeTab: TabId;
  switchTab: (tab: TabId) => void;
  submitted: boolean;
  handleSubmit: (e: React.FormEvent) => void;
  setSubmitted: (v: boolean) => void;
}) {
  return (
    <section className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 border-t border-gray-200">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 mb-8">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => switchTab(tab.id)}
              className={cn(
                "px-4 h-10 rounded-full text-sm font-bold border-2 transition-[color,background-color,border-color] duration-150 inline-flex items-center gap-1.5",
                active
                  ? "filter-pill-active bg-brand-pink/10 border-brand-pink/40 text-brand-pink"
                  : "filter-pill bg-white border-gray-200 text-soft-ink hover:text-foreground hover:border-gray-300",
              )}
            >
              <TabIcon className="h-3.5 w-3.5" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Success state */}
      {submitted ? (
        <div className="game-card border-2 border-brand-mint/30 bg-brand-mint/5 p-8 sm:p-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-brand-mint mx-auto mb-4" />
          <h2 className="font-display text-2xl text-foreground mb-2">Thanks!</h2>
          <p className="text-sm text-soft-ink max-w-md mx-auto leading-relaxed mb-6">
            This preview form has recorded your interest locally. Live submissions will be connected
            in the next phase. For live enquiries, email {legacyContact.email}.
          </p>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-full bg-white border-2 border-gray-200 text-foreground font-bold text-sm hover:border-gray-300 transition-colors"
          >
            Send another enquiry
          </button>
        </div>
      ) : (
        <div className="game-card border-2 border-gray-200 bg-white p-6 sm:p-8">
          {activeTab === "brand" && <BrandForm onSubmit={handleSubmit} />}
          {activeTab === "creator" && <CreatorForm onSubmit={handleSubmit} />}
          {activeTab === "adfoplace" && <AdfoplaceForm onSubmit={handleSubmit} />}
          {activeTab === "capital" && <CapitalForm onSubmit={handleSubmit} />}
          {activeTab === "partner" && <PartnerForm onSubmit={handleSubmit} />}
        </div>
      )}
    </section>
  );
}

function BrandForm({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) {
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    phone: "",
    campaignInterest: campaignInterests[0],
    budget: budgetRanges[0],
    market: markets[0],
    message: "",
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="flex items-center gap-2 mb-1">
        <Building2 className="h-5 w-5 text-brand-pink" />
        <h2 className="font-display text-xl text-foreground">Brand Enquiry</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name">
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder="Your name"
          />
        </Field>
        <Field label="Company">
          <Input
            name="company"
            value={form.company}
            onChange={(v) => setForm({ ...form, company: v })}
            required
            placeholder="Your company"
          />
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Phone / WhatsApp">
          <Input
            name="phone"
            type="tel"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
            placeholder="+852 xxxx xxxx"
          />
        </Field>
        <Field label="Campaign Interest">
          <Select
            name="campaignInterest"
            value={form.campaignInterest}
            options={campaignInterests}
            onChange={(v) => setForm({ ...form, campaignInterest: v })}
          />
        </Field>
        <Field label="Budget Range">
          <Select
            name="budget"
            value={form.budget}
            options={budgetRanges}
            onChange={(v) => setForm({ ...form, budget: v })}
          />
        </Field>
        <Field label="Market">
          <Select
            name="market"
            value={form.market}
            options={markets}
            onChange={(v) => setForm({ ...form, market: v })}
          />
        </Field>
      </div>

      <Field label="Message">
        <textarea
          name="message"
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          rows={4}
          className="w-full rounded-xl bg-white border-2 border-gray-200 px-4 py-3 text-sm text-foreground placeholder-gray-400 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-pink/40 focus-visible:border-brand-pink/50 transition-[border-color,box-shadow] duration-150 resize-none"
          placeholder="Tell us about your campaign goals, timeline, and target audience..."
        />
      </Field>

      <button
        type="submit"
        className="h-12 rounded-full bg-primary text-primary-foreground font-bold text-sm hover:bg-rose-hover transition-colors inline-flex items-center justify-center gap-2"
      >
        <Send className="h-4 w-4" /> Send Brand Enquiry
      </button>

      <p className="text-[10px] text-soft-ink/70 text-center">
        Preview form: for live enquiries, email {legacyContact.email}.
      </p>
    </form>
  );
}

function CreatorForm({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    socialHandle: "",
    mainCategory: mainCategories[0],
    currentLevel: selfSelectLevels[0],
    interests: {
      missions: false,
      offers: false,
      academy: false,
      capitalWaitlist: false,
    },
  });

  const toggleInterest = (key: keyof typeof form.interests) => {
    setForm({ ...form, interests: { ...form.interests, [key]: !form.interests[key] } });
  };

  const interestLabels: { key: keyof typeof form.interests; label: string; emoji: string }[] = [
    { key: "missions", label: "Missions", emoji: "🎯" },
    { key: "offers", label: "Adfoplace Offers", emoji: "🛍️" },
    { key: "academy", label: "Academy & Resources", emoji: "📚" },
    { key: "capitalWaitlist", label: "Capital Waitlist", emoji: "🏦" },
  ];

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="flex items-center gap-2 mb-1">
        <User className="h-5 w-5 text-brand-mint" />
        <h2 className="font-display text-xl text-foreground">Creator Signup</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name">
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder="Your name"
          />
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@email.com"
          />
        </Field>
        <Field label="Phone / WhatsApp">
          <Input
            name="phone"
            type="tel"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
            placeholder="+852 xxxx xxxx"
          />
        </Field>
        <Field label="Social Handle">
          <Input
            name="socialHandle"
            value={form.socialHandle}
            onChange={(v) => setForm({ ...form, socialHandle: v })}
            placeholder="@yourhandle"
          />
        </Field>
        <Field label="Main Category">
          <Select
            name="mainCategory"
            value={form.mainCategory}
            options={mainCategories}
            onChange={(v) => setForm({ ...form, mainCategory: v })}
          />
        </Field>
        <Field label="Current Level (Self-Select)">
          <Select
            name="currentLevel"
            value={form.currentLevel}
            options={selfSelectLevels}
            onChange={(v) => setForm({ ...form, currentLevel: v })}
          />
        </Field>
      </div>

      <Field label="I'm interested in">
        <div className="flex flex-wrap gap-2">
          {interestLabels.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => toggleInterest(item.key)}
              className={cn(
                "px-4 h-10 rounded-full text-sm font-bold border-2 transition-[color,background-color,border-color] duration-150 inline-flex items-center gap-1.5",
                form.interests[item.key]
                  ? "bg-brand-mint/10 border-brand-mint/40 text-brand-mint"
                  : "bg-white border-gray-200 text-soft-ink hover:text-foreground hover:border-gray-300",
              )}
            >
              {item.emoji} {item.label}
            </button>
          ))}
        </div>
      </Field>

      <button
        type="submit"
        className="h-12 rounded-full bg-brand-mint text-foreground font-bold text-sm hover:bg-mint/85 transition-colors inline-flex items-center justify-center gap-2"
      >
        <Sparkles className="h-4 w-4" /> Join as Creator
      </button>

      <p className="text-[10px] text-soft-ink/70 text-center">
        Preview form: for live creator enquiries, email {legacyContact.email}.
      </p>
    </form>
  );
}

function AdfoplaceForm({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) {
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    offerType: "Affiliate",
    message: "",
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="flex items-center gap-2 mb-1">
        <Store className="h-5 w-5 text-brand-blue" />
        <h2 className="font-display text-xl text-foreground">List an Adfoplace Offer</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name">
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder="Your name"
          />
        </Field>
        <Field label="Company">
          <Input
            name="company"
            value={form.company}
            onChange={(v) => setForm({ ...form, company: v })}
            required
            placeholder="Brand / company name"
          />
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Offer Type">
          <Select
            name="offerType"
            value={form.offerType}
            options={[
              "Affiliate",
              "Product Trial",
              "Coupon",
              "UGC Job",
              "Live Shopping",
              "Ambassador",
              "Product Drop",
            ]}
            onChange={(v) => setForm({ ...form, offerType: v })}
          />
        </Field>
      </div>

      <Field label="Message">
        <textarea
          name="message"
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          rows={4}
          className="w-full rounded-xl bg-white border-2 border-gray-200 px-4 py-3 text-sm text-foreground placeholder-gray-400 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-blue/40 focus-visible:border-brand-blue/50 transition-[border-color,box-shadow] duration-150 resize-none"
          placeholder="Describe the offer, reward structure, and creator requirements..."
        />
      </Field>

      <button
        type="submit"
        className="h-12 rounded-full bg-sky text-foreground font-bold text-sm hover:bg-brand-blue/90 transition-colors inline-flex items-center justify-center gap-2"
      >
        <Store className="h-4 w-4" /> Submit Offer Request
      </button>

      <p className="text-[10px] text-soft-ink/70 text-center">
        Preview form: for live offer enquiries, email {legacyContact.email}.
      </p>
    </form>
  );
}

function CapitalForm({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) {
  const [form, setForm] = useState({
    name: "",
    creatorHandle: "",
    email: "",
    estimatedMonthlyIncome: "",
    mainIncomeStream: incomeStreams[0],
    reason: "",
    consent: false,
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="flex items-center gap-2 mb-1">
        <Wallet className="h-5 w-5 text-brand-yellow" />
        <h2 className="font-display text-xl text-foreground">Capital Waitlist</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name">
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder="Your name"
          />
        </Field>
        <Field label="Creator Handle">
          <Input
            name="creatorHandle"
            value={form.creatorHandle}
            onChange={(v) => setForm({ ...form, creatorHandle: v })}
            required
            placeholder="@yourhandle"
          />
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@email.com"
          />
        </Field>
        <Field label="Estimated Monthly Income">
          <Input
            name="estimatedMonthlyIncome"
            value={form.estimatedMonthlyIncome}
            onChange={(v) => setForm({ ...form, estimatedMonthlyIncome: v })}
            placeholder="e.g. HK$5,000"
          />
        </Field>
        <Field label="Main Income Stream">
          <Select
            name="mainIncomeStream"
            value={form.mainIncomeStream}
            options={incomeStreams}
            onChange={(v) => setForm({ ...form, mainIncomeStream: v })}
          />
        </Field>
      </div>

      <Field label="Why are you interested in creator capital?">
        <textarea
          name="reason"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          rows={3}
          className="w-full rounded-xl bg-white border-2 border-gray-200 px-4 py-3 text-sm text-foreground placeholder-gray-400 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-yellow/40 focus-visible:border-brand-yellow/50 transition-[border-color,box-shadow] duration-150 resize-none"
          placeholder="e.g. Equipment funding, campaign float, business growth..."
        />
      </Field>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(e) => setForm({ ...form, consent: e.target.checked })}
          required
          className="mt-1 h-4 w-4 rounded border-2 border-gray-300 text-brand-yellow focus:ring-brand-yellow shrink-0"
        />
        <span className="text-xs text-soft-ink leading-relaxed">
          I understand this is a preview waitlist only. Adfocate does not provide financing in this
          prototype. Any capital or payout advance product would be subject to eligibility, risk
          assessment, approval, and applicable licensed partner or regulatory arrangements.
        </span>
      </label>

      <button
        type="submit"
        className="h-12 rounded-full bg-brand-yellow text-foreground font-bold text-sm hover:bg-butter/85 transition-colors inline-flex items-center justify-center gap-2"
      >
        <Wallet className="h-4 w-4" /> Join Capital Waitlist
      </button>

      <p className="text-[10px] text-soft-ink/70 text-center">
        Preview form: for live capital enquiries, email {legacyContact.email}.
      </p>
    </form>
  );
}

function PartnerForm({ onSubmit }: { onSubmit: (e: React.FormEvent) => void }) {
  const [form, setForm] = useState({
    name: "",
    company: "",
    email: "",
    partnershipType: "Technology",
    message: "",
  });

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <div className="flex items-center gap-2 mb-1">
        <Users className="h-5 w-5 text-brand-lilac" />
        <h2 className="font-display text-xl text-foreground">Partner Enquiry</h2>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name">
          <Input
            name="name"
            value={form.name}
            onChange={(v) => setForm({ ...form, name: v })}
            required
            placeholder="Your name"
          />
        </Field>
        <Field label="Company">
          <Input
            name="company"
            value={form.company}
            onChange={(v) => setForm({ ...form, company: v })}
            required
            placeholder="Your company"
          />
        </Field>
        <Field label="Email">
          <Input
            name="email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
            placeholder="you@company.com"
          />
        </Field>
        <Field label="Partnership Type">
          <Select
            name="partnershipType"
            value={form.partnershipType}
            options={["Technology", "Agency", "Platform", "Financial Services", "Media", "Other"]}
            onChange={(v) => setForm({ ...form, partnershipType: v })}
          />
        </Field>
      </div>

      <Field label="Message">
        <textarea
          name="message"
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          rows={4}
          className="w-full rounded-xl bg-white border-2 border-gray-200 px-4 py-3 text-sm text-foreground placeholder-gray-400 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-lilac/40 focus-visible:border-brand-lilac/50 transition-[border-color,box-shadow] duration-150 resize-none"
          placeholder="Tell us about the partnership opportunity..."
        />
      </Field>

      <button
        type="submit"
        className="h-12 rounded-full bg-secondary text-secondary-foreground font-bold text-sm hover:bg-brand-lilac/90 transition-colors inline-flex items-center justify-center gap-2"
      >
        <Send className="h-4 w-4" /> Send Partner Enquiry
      </button>

      <p className="text-[10px] text-soft-ink/70 text-center">
        Preview form: for live partnership enquiries, email {legacyContact.email}.
      </p>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-soft-ink font-bold">
        {label}
      </span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function Input({
  name,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      name={name}
      type={type}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-11 rounded-full bg-white border-2 border-gray-200 px-4 text-sm text-foreground placeholder-gray-400 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-pink/40 focus-visible:border-brand-pink/50 transition-[border-color,box-shadow] duration-150"
    />
  );
}

function Select({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-11 rounded-full bg-white border-2 border-gray-200 px-4 text-sm text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-pink/40 focus-visible:border-brand-pink/50 transition-[border-color,box-shadow] duration-150 appearance-none cursor-pointer"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
