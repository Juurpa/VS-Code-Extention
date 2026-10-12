import sys,re,subprocess
def words(f,first=1):
    t=subprocess.run(['pdftotext','-f',str(first),'-l',str(first),f,'-'],capture_output=True,text=True).stdout
    return re.findall(r'\S+',t)
a=words(sys.argv[1]); b=words(sys.argv[2])
from collections import Counter
ca,cb=Counter(a),Counter(b)
hit=sum((ca&cb).values())
print('orig words',len(a),'ocr words',len(b),'recall %.1f%%'%(100*hit/max(1,len(a))),'precision %.1f%%'%(100*hit/max(1,len(b))))
miss=list((ca-cb).elements())[:25]; print('missed sample:',miss)
