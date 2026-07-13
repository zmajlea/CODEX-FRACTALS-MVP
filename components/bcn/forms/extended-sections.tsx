"use client";

import { Field, TextAreaField } from "@/components/bcn/atoms/Field";
import { FGrid, Panel } from "@/components/bcn/forms/Panel";
import {
  CheckToggle,
  NotesPanel,
  RatingRows,
  RoleBlocksEditor,
  SegmentChoice,
  TableEditor,
} from "@/components/bcn/forms/blocks";
import type {
  BusinessSectionPayload,
  ContinuitySectionPayload,
  DigitalSectionPayload,
  EmergencySectionPayload,
  FamilySectionPayload,
  FinancialSectionPayload,
  LocatorSectionPayload,
  StorySectionPayload,
  TransitionSectionPayload,
  ValuesSectionPayload,
} from "@/lib/bcn/section-payloads";

type BaseProps<T> = {
  value: T;
  onChange: (next: T) => void;
  onBlur: () => void;
  disabled?: boolean;
};

export function LocatorSectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<LocatorSectionPayload>) {
  return (
    <Panel title="Where Things Live" icon="compass">
      <div className="loc-table">
        {value.rows.map((row, index) => (
          <div className="loc-row" key={row.cat}>
            <div className="loc-cat">
              <span className="loc-name">{row.cat}</span>
              {row.sub ? <span className="loc-sub">{row.sub}</span> : null}
            </div>
            <div className="loc-exists" role="group" aria-label="Exists?">
              <button
                type="button"
                className={`seg${row.exists === "yes" ? " on" : ""}`}
                disabled={disabled}
                onClick={() => {
                  const rows = [...value.rows];
                  rows[index] = { ...row, exists: "yes" };
                  onChange({ rows });
                }}
              >
                Yes
              </button>
              <button
                type="button"
                className={`seg${row.exists === "no" ? " on" : ""}`}
                disabled={disabled}
                onClick={() => {
                  const rows = [...value.rows];
                  rows[index] = { ...row, exists: "no" };
                  onChange({ rows });
                }}
              >
                No
              </button>
            </div>
            <div className="field loc-where">
              <label>Location / where to find it</label>
              <input
                type="text"
                placeholder={row.placeholder}
                value={row.location}
                disabled={disabled}
                onChange={(e) => {
                  const rows = [...value.rows];
                  rows[index] = { ...row, location: e.target.value };
                  onChange({ rows });
                }}
                onBlur={onBlur}
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function BusinessSectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<BusinessSectionPayload>) {
  return (
    <>
      <Panel title="Business dependency" icon="building">
        <SegmentChoice
          label="How dependent is the business on me?"
          options={["Completely", "Heavily", "Moderately", "Minimally"]}
          value={value.dependency}
          disabled={disabled}
          onChange={(dependency) => onChange({ ...value, dependency })}
        />
      </Panel>
      <RoleBlocksEditor
        title="Who understands this business best?"
        icon="people"
        blocks={value.understandBlocks}
        fieldKeys={["Name", "Relationship", "Role"]}
        disabled={disabled}
        onChange={(understandBlocks) => onChange({ ...value, understandBlocks })}
        onBlur={onBlur}
      />
      <RoleBlocksEditor
        title="Who can help my family evaluate options?"
        icon="scale"
        blocks={value.evaluateBlocks}
        fieldKeys={["Name", "Relationship", "Role"]}
        disabled={disabled}
        onChange={(evaluateBlocks) => onChange({ ...value, evaluateBlocks })}
        onBlur={onBlur}
      />
      <NotesPanel
        label="Important observations"
        value={value.notes}
        disabled={disabled}
        onChange={(notes) => onChange({ ...value, notes })}
        onBlur={onBlur}
      />
    </>
  );
}

export function TransitionSectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<TransitionSectionPayload>) {
  return (
    <>
      <Panel title="Possible options" icon="briefcase">
        <p className="panel-note">
          Check any that may apply. Each is a starting point for a conversation with your
          advisors.
        </p>
        <div className="opt-list">
          {value.options.map((opt, index) => (
            <div className="opt-row" key={opt.label}>
              <CheckToggle
                label={opt.label}
                description={opt.desc}
                checked={opt.checked}
                disabled={disabled}
                onChange={(checked) => {
                  const options = [...value.options];
                  options[index] = { ...opt, checked };
                  onChange({ ...value, options });
                }}
              />
              <input
                type="text"
                className="opt-note"
                aria-label={`${opt.label} notes`}
                placeholder="Notes / considerations…"
                value={opt.note}
                disabled={disabled}
                onChange={(e) => {
                  const options = [...value.options];
                  options[index] = { ...opt, note: e.target.value };
                  onChange({ ...value, options });
                }}
                onBlur={onBlur}
              />
            </div>
          ))}
        </div>
      </Panel>
      <NotesPanel
        label="Before making any decision about the business, I would want my family to know"
        value={value.notes}
        disabled={disabled}
        onChange={(notes) => onChange({ ...value, notes })}
        onBlur={onBlur}
      />
      <Panel title="How these decisions usually unfold" icon="compass">
        <ul className="guide-list">
          {value.guidance.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

export function FinancialSectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<FinancialSectionPayload>) {
  return (
    <>
      <RoleBlocksEditor
        title="Resources & protections"
        icon="money"
        blocks={value.blocks}
        fieldKeys={["Primary Institutions", "Account Types", "Location of Information"]}
        disabled={disabled}
        onChange={(blocks) => onChange({ ...value, blocks })}
        onBlur={onBlur}
      />
      <NotesPanel
        label="Additional notes"
        value={value.notes}
        disabled={disabled}
        onChange={(notes) => onChange({ ...value, notes })}
        onBlur={onBlur}
      />
    </>
  );
}

export function ContinuitySectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<ContinuitySectionPayload>) {
  return (
    <>
      <RoleBlocksEditor
        title="Who is responsible for immediate continuity?"
        icon="shield"
        blocks={value.leadershipBlocks}
        fieldKeys={["Name", "Phone", "Email", "Key Responsibilities"]}
        disabled={disabled}
        onChange={(leadershipBlocks) => onChange({ ...value, leadershipBlocks })}
        onBlur={onBlur}
      />
      <RoleBlocksEditor
        title="Are key relationships being attended to?"
        icon="people"
        blocks={value.relationshipBlocks}
        fieldKeys={["Name", "Role", "Phone", "Notes"]}
        disabled={disabled}
        onChange={(relationshipBlocks) => onChange({ ...value, relationshipBlocks })}
        onBlur={onBlur}
      />
      <Panel title="If my family feels overwhelmed" icon="heart">
        <FGrid>
          <Field
            label="Speak with first"
            value={value.overwhelmFirst}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, overwhelmFirst: e.target.value })}
            onBlur={onBlur}
          />
          <Field
            label="Then"
            value={value.overwhelmThen}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, overwhelmThen: e.target.value })}
            onBlur={onBlur}
          />
          <Field
            label="Then"
            value={value.overwhelmFinally}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, overwhelmFinally: e.target.value })}
            onBlur={onBlur}
          />
        </FGrid>
      </Panel>
      <NotesPanel
        label="Important notes"
        value={value.notes}
        disabled={disabled}
        onChange={(notes) => onChange({ ...value, notes })}
        onBlur={onBlur}
      />
    </>
  );
}

export function DigitalSectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<DigitalSectionPayload>) {
  return (
    <>
      <Panel title="Critical access" icon="key">
        <FGrid>
          <Field
            label="Location of password manager"
            value={value.passwordManager}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, passwordManager: e.target.value })}
            onBlur={onBlur}
          />
          <Field
            label="Location of digital vault"
            value={value.digitalVault}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, digitalVault: e.target.value })}
            onBlur={onBlur}
          />
          <Field
            label="Person authorized to assist"
            value={value.authorizedPerson}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, authorizedPerson: e.target.value })}
            onBlur={onBlur}
          />
          <Field
            label="Their phone"
            value={value.authorizedPhone}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, authorizedPhone: e.target.value })}
            onBlur={onBlur}
          />
        </FGrid>
      </Panel>
      <NotesPanel
        label="Online accounts, cloud, domains, subscriptions"
        value={value.notes}
        disabled={disabled}
        onChange={(notes) => onChange({ ...value, notes })}
        onBlur={onBlur}
      />
    </>
  );
}

export function EmergencySectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<EmergencySectionPayload>) {
  return (
    <>
      <TableEditor
        title="Emergency contacts"
        icon="cross"
        columns={["Name", "Relationship", "Primary Phone", "Alternate Phone"]}
        rows={value.contacts}
        disabled={disabled}
        onChange={(contacts) => onChange({ ...value, contacts })}
        onBlur={onBlur}
      />
      <Panel title="Medical information" icon="heart">
        <FGrid>
          <Field
            label="Primary doctor"
            value={value.medical.primaryDoctor}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                medical: { ...value.medical, primaryDoctor: e.target.value },
              })
            }
            onBlur={onBlur}
          />
          <Field
            label="Phone"
            value={value.medical.doctorPhone}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                medical: { ...value.medical, doctorPhone: e.target.value },
              })
            }
            onBlur={onBlur}
          />
          <TextAreaField
            label="Allergies"
            value={value.medical.allergies}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                ...value,
                medical: { ...value.medical, allergies: e.target.value },
              })
            }
            onBlur={onBlur}
          />
        </FGrid>
      </Panel>
    </>
  );
}

export function FamilySectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<FamilySectionPayload>) {
  return (
    <>
      <TableEditor
        title="Household members"
        icon="people"
        columns={["Full name", "Date of birth", "Relationship"]}
        rows={value.household}
        disabled={disabled}
        onChange={(household) => onChange({ ...value, household })}
        onBlur={onBlur}
      />
      <TableEditor
        title="Pets"
        icon="person"
        columns={["Pet name", "Veterinarian", "Phone"]}
        rows={value.pets}
        disabled={disabled}
        onChange={(pets) => onChange({ ...value, pets })}
        onBlur={onBlur}
      />
      <NotesPanel
        label="Notes for my family"
        value={value.notes}
        disabled={disabled}
        onChange={(notes) => onChange({ ...value, notes })}
        onBlur={onBlur}
      />
    </>
  );
}

export function ValuesSectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<ValuesSectionPayload>) {
  return (
    <>
      <Panel title="My core values" icon="heart">
        <FGrid one>
          {value.coreValues.map((line, index) => (
            <Field
              key={index}
              label={`Value ${index + 1}`}
              value={line}
              disabled={disabled}
              onChange={(e) => {
                const coreValues = [...value.coreValues];
                coreValues[index] = e.target.value;
                onChange({ ...value, coreValues });
              }}
              onBlur={onBlur}
            />
          ))}
        </FGrid>
      </Panel>
      <Panel title="What made the journey worthwhile" icon="heart">
        <RatingRows
          rows={value.ratings}
          disabled={disabled}
          onChange={(ratings) => onChange({ ...value, ratings })}
          onBlur={onBlur}
        />
      </Panel>
      <NotesPanel
        label="The impact I hope to have"
        value={value.impactNotes}
        disabled={disabled}
        onChange={(impactNotes) => onChange({ ...value, impactNotes })}
        onBlur={onBlur}
      />
    </>
  );
}

export function StorySectionForm({
  value,
  onChange,
  onBlur,
  disabled,
}: BaseProps<StorySectionPayload>) {
  return (
    <>
      <Panel title="The story of this business" icon="pen">
        <div className="prompts">
          {value.prompts.map((prompt, index) => (
            <div className="prompt" key={prompt.n}>
              <div className="prompt-n">{prompt.n}</div>
              <div className="prompt-body">
                <div className="prompt-title">{prompt.title}</div>
                <div className="prompt-hint">{prompt.hint}</div>
                <textarea
                  rows={prompt.body ? 4 : 2}
                  value={prompt.body}
                  disabled={disabled}
                  onChange={(e) => {
                    const prompts = [...value.prompts];
                    prompts[index] = { ...prompt, body: e.target.value };
                    onChange({ ...value, prompts });
                  }}
                  onBlur={onBlur}
                />
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="A word to my family" className="letter-panel">
        <p className="letter-lead">{value.letterLead}</p>
        <textarea
          className="letter"
          rows={10}
          value={value.letterBody}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, letterBody: e.target.value })}
          onBlur={onBlur}
        />
      </Panel>
    </>
  );
}
