"""Print the text of a PDF (used for 新潟県水産海洋研究所 海況情報). Needs pdfminer.six.
usage: python3 tools/intel/pdftext.py file.pdf
"""
import sys

from pdfminer.high_level import extract_text

print(extract_text(sys.argv[1]))
