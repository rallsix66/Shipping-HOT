// TH-C02 synthetic rows moved verbatim from server/intel/thai-document-index.test.ts (shared test reuse).
// Authored synthetic rows; not copied from the unknown-permission raw page.
export function markup(secondId = "second", date = "8 ตุลาคม 2569", secondTitle = "Synthetic same document title") {
  return `<table class="table table-hover"><tbody>
<tr><td>1</td><td>120/2569</td><td><a href="cont_strc_download_with_docno_date.php?lang=th&current_id=first">Synthetic same document title</a></td><td>9 ตุลาคม 2569</td><td>120</td></tr>
<tr><td>2</td><td>124/2569</td><td><a href="cont_strc_download_with_docno_date.php?lang=th&current_id=${secondId}">${secondTitle}</a></td><td>${date}</td><td>137</td></tr>
</tbody></table>`
}
