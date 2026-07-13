"use client";

import { SectionCrumb } from "@/components/bcn/chrome/SectionCrumb";
import { SectionHead } from "@/components/bcn/chrome/SectionHead";
import { SectionWhy } from "@/components/bcn/chrome/SectionWhy";
import { SealBar } from "@/components/bcn/chrome/SealBar";
import { AdvisorsSectionForm } from "@/components/bcn/forms/AdvisorsSectionForm";
import { PeopleSectionForm } from "@/components/bcn/forms/PeopleSectionForm";
import {
  BusinessSectionForm,
  ContinuitySectionForm,
  DigitalSectionForm,
  EmergencySectionForm,
  FamilySectionForm,
  FinancialSectionForm,
  LocatorSectionForm,
  StorySectionForm,
  TransitionSectionForm,
  ValuesSectionForm,
} from "@/components/bcn/forms/extended-sections";
import { useBcnThemeOptional } from "@/components/bcn/BcnThemeContext";
import type { BcnSectionDef, BcnSectionPayload } from "@/lib/bcn/sections";
import {
  parseAdvisorsPayload,
  parseBusinessPayload,
  parseContinuityPayload,
  parseDigitalPayload,
  parseEmergencyPayload,
  parseFamilyPayload,
  parseFinancialPayload,
  parseLocatorPayload,
  parsePeoplePayload,
  parseStoryPayload,
  parseTransitionPayload,
  parseValuesPayload,
} from "@/lib/bcn/section-payloads";

type SectionStatus = "empty" | "saved" | "sealed";

type Props = {
  section: BcnSectionDef;
  vaultName: string;
  vaultId: string;
  signer: string;
  status: SectionStatus;
  payload: BcnSectionPayload;
  sealing: boolean;
  onHome: () => void;
  onPayloadChange: (next: BcnSectionPayload) => void;
  onSave: () => void;
  onSeal: () => void;
  onEditStart: () => void;
};

export function SectionView({
  section,
  vaultName,
  vaultId,
  signer,
  status,
  payload,
  sealing,
  onHome,
  onPayloadChange,
  onSave,
  onSeal,
  onEditStart,
}: Props) {
  const theme = useBcnThemeOptional();
  const disabled = sealing;
  const recordLabel = `${vaultName}'s Navigator`;

  function change(next: BcnSectionPayload) {
    onEditStart();
    onPayloadChange(next);
  }

  let body: React.ReactNode;
  if (section.id === "people") {
    body = (
      <PeopleSectionForm
        value={parsePeoplePayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "advisors") {
    body = (
      <AdvisorsSectionForm
        value={parseAdvisorsPayload(payload)}
        vaultId={vaultId}
        clientName={vaultName}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "locator") {
    body = (
      <LocatorSectionForm
        value={parseLocatorPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "business") {
    body = (
      <BusinessSectionForm
        value={parseBusinessPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "transition") {
    body = (
      <TransitionSectionForm
        value={parseTransitionPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "financial") {
    body = (
      <FinancialSectionForm
        value={parseFinancialPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "continuity") {
    body = (
      <ContinuitySectionForm
        value={parseContinuityPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "digital") {
    body = (
      <DigitalSectionForm
        value={parseDigitalPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "emergency") {
    body = (
      <EmergencySectionForm
        value={parseEmergencyPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "family") {
    body = (
      <FamilySectionForm
        value={parseFamilyPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "values") {
    body = (
      <ValuesSectionForm
        value={parseValuesPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  } else if (section.id === "story") {
    body = (
      <StorySectionForm
        value={parseStoryPayload(payload)}
        disabled={disabled}
        onBlur={onSave}
        onChange={(next) => change(next)}
      />
    );
  }

  return (
    <section className="view on" aria-label={section.title}>
      <SectionCrumb recordLabel={recordLabel} sectionLabel={section.short} onHome={onHome} />
      <SectionHead title={section.title} status={status} />
      <SectionWhy
        why={section.why}
        subtitle={section.subtitle}
        dataBrand={theme.dataBrand}
      />
      {body}
      <SealBar
        sectionId={section.id}
        signer={signer}
        sealing={sealing}
        sealed={status === "sealed"}
        onSeal={onSeal}
      />
    </section>
  );
}
