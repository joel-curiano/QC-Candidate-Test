"""Generate the QC Excel question bank used by the Streamlit importer.

The prompts are original assessment items organized around publicly indexed
Saudi Aramco standard identifiers. They are not extracts of Aramco standards.
Review every item against the controlled project revision before use.
"""
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HEADERS = ['Discipline', 'Question type', 'Question', 'Multiple Choice options',
           'Correct answer', 'Scoring rubric', 'Maximum points']
DISCIPLINES = {
    'Coating QC': 'SAES-H-001; 09-SAMSS-060; 09-SAMSS-065',
    'Communications QC': 'SAES-T-911; SAES-T-916; SAES-T-919',
}
TOPICS = [
    'approved drawings and specifications', 'inspection and test plan hold points',
    'material receiving and traceability', 'calibration and equipment status',
    'qualified personnel and procedure control', 'site documentation and records',
    'nonconformance reporting and disposition', 'inspection release and handover',
    'change control and technical queries', 'preservation and storage',
    'pre-inspection verification', 'workmanship acceptance criteria',
    'sampling and inspection extent', 'test result review', 'vendor documentation',
    'field change identification', 'punch-list closure', 'quality surveillance',
    'safety interface during inspection', 'final dossier completeness',
]
MCQ_VARIANTS = [
    (
        'A field result related to {topic} does not meet the approved requirement. What should the {discipline} inspector do first?',
        [
            'Hold the affected work, record the result, and request an approved disposition',
            'Accept the result when the construction team agrees',
            'Change the acceptance limit on the inspection report',
            'Release the work and resolve the record during handover',
        ],
    ),
    (
        'Which evidence best demonstrates effective control of {topic} during a {discipline} inspection?',
        [
            'An approved, traceable record linked to the inspected item and acceptance requirement',
            'An unsigned verbal confirmation from the work crew',
            'A photograph without item identification or inspection date',
            'A draft checklist completed after the work was released',
        ],
    ),
    (
        'Before releasing work affected by {topic}, which verification is most appropriate for the {discipline} inspector?',
        [
            'Confirm the applicable requirement, inspection result, traceability, and required approvals',
            'Confirm only that the activity is physically complete',
            'Use the previous work package result without checking applicability',
            'Ask construction to approve its own unresolved deviation',
        ],
    ),
    (
        'A deviation involving {topic} is found during {discipline} surveillance. Which response preserves quality control?',
        [
            'Identify the affected item, document the deviation, prevent unintended release, and track closure',
            'Correct the record so it matches the installed condition',
            'Wait for final turnover before reporting the deviation',
            'Remove the inspection hold point without authorization',
        ],
    ),
]

REVIEWER_PROMPTS = {
    'essay': [
        'Develop a written inspection approach for {topic} in a {discipline} work package. Explain the acceptance basis, inspection sequence, records, and escalation path.',
        'Analyze a case where {topic} was not adequately controlled during {discipline} work. Explain the risks, immediate containment, corrective action, and evidence needed for closure.',
    ],
    'oral': [
        'Brief the interview panel on how you would verify {topic} as a {discipline} inspector. State the documents you would consult, questions you would ask, and release decision you would make.',
        'During an oral review, defend your response to a disputed {topic} finding in {discipline} work. Explain how you would communicate the requirement, protect the work, and obtain an approved resolution.',
    ],
    'practicum': [
        'Using a sample work package, demonstrate the checks you would perform for {topic} during a {discipline} inspection. Identify each record you would complete or endorse.',
        'Given a simulated nonconformance involving {topic}, demonstrate how a {discipline} inspector would identify the affected item, document evidence, control release, and verify closure.',
    ],
}


def rubric(kind, reference, topic):
    if kind == 'mcq':
        return f'Answer key: option 1. Reference focus: {reference}. Verify against the current controlled revision and project ITP before use.'
    return (f'Assess accuracy, sequence, objective evidence, traceability, and escalation. '
            f'Reference focus: {reference}; topic: {topic}. Verify against the current controlled revision and project requirements before use.')


def build_rows():
    rows = []
    for discipline, reference in DISCIPLINES.items():
        for topic in TOPICS[:10]:
            for prompt_template, option_pool in MCQ_VARIANTS:
                rows.append([discipline, 'mcq',
                    prompt_template.format(topic=topic, discipline=discipline),
                    '\n'.join(option_pool), option_pool[0], rubric('mcq', reference, topic), 1])
            for kind, prompt_templates in REVIEWER_PROMPTS.items():
                for prompt_template in prompt_templates:
                    rows.append([discipline, kind,
                        prompt_template.format(topic=topic, discipline=discipline),
                        '', '', rubric(kind, reference, topic), 15 if kind != 'practicum' else 20])
    normalized = [' '.join(row[2].lower().split()) for row in rows]
    if len(normalized) != len(set(normalized)):
        raise ValueError('Generated question text contains duplicates.')
    return rows


def create_workbook(path):
    rows = build_rows()
    assert len(rows) == len(DISCIPLINES) * 100
    assert all(sum(row[0] == discipline for row in rows) == 100 for discipline in DISCIPLINES)
    wb = Workbook()
    ws = wb.active
    ws.title = 'Questions'
    ws.append(HEADERS)
    for row in rows:
        ws.append(row)
    ws.freeze_panes = 'A2'
    ws.auto_filter.ref = f'A1:G{ws.max_row}'
    ws.sheet_view.showGridLines = False
    widths = [24, 16, 100, 55, 48, 100, 16]
    for index, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(index)].width = width
    header_fill = PatternFill('solid', fgColor='F2F2F2')
    for cell in ws[1]:
        cell.font = Font(bold=True, color='800000')
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical='top', wrap_text=cell.column in (3, 4, 6))
    dv_kind = DataValidation(type='list', formula1='"mcq,essay,oral,practicum,practical"', allow_blank=False)
    ws.add_data_validation(dv_kind)
    dv_kind.add(f'B2:B{ws.max_row}')
    instructions = wb.create_sheet('Instructions')
    instructions.append(['QC question template'])
    instructions.append(['This workbook contains original assessment prompts aligned to public Saudi Aramco standard identifiers. It does not reproduce Aramco standards. Validate each question against your controlled, current project revision before use.'])
    instructions.append(['Counts per discipline: 40 MCQ, 20 essay, 20 oral, 20 practicum. Options are required only for MCQ rows.'])
    instructions.append(['Do not change the seven Questions headers. Upload this workbook through Admin > Question bank > Import questions.'])
    instructions.append(['References used as topic anchors: SAES-W-011, SAES-W-012, SAES-L-105, SAES-Q-001, SAES-P-111, SAES-J-003, and related SAMSS identifiers. Confirm applicability with the project quality plan.'])
    instructions.column_dimensions['A'].width = 120
    for row in instructions.iter_rows():
        for cell in row:
            cell.alignment = Alignment(vertical='top', wrap_text=True)
    instructions.row_dimensions[2].height = 42
    instructions.row_dimensions[5].height = 36
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return len(rows)


if __name__ == '__main__':
    output = Path(__file__).parents[1] / 'qc-question-template.xlsx'
    print(f'Wrote {create_workbook(output)} questions to {output}')
