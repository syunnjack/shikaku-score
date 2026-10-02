# e-Gov の法令JSONから条文を取り出す。**問題を作る前に必ずこれで原文を見る。**
import json,io,os,sys,re
SP=os.path.dirname(os.path.abspath(__file__))
IDS={'行政手続法':'405AC0000000088','行政不服審査法':'426AC0000000068',
     '行政事件訴訟法':'337AC0000000139','国家賠償法':'322AC0000000125',
     '憲法':'321CONSTITUTION','地方自治法':'322AC0000000067'}
def text(n):
    if isinstance(n,str): return n
    if isinstance(n,dict):
        t=''.join(text(c) for c in (n.get('children') or []))
        return t
    if isinstance(n,list): return ''.join(text(c) for c in n)
    return ''
def articles(law):
    d=json.load(io.open(os.path.join(SP,IDS[law]+'.dat'),encoding='utf-8'))
    out={}
    # **附則（SupplProvision）には本則と同じ条番号が入っている。**
    # 区別せずに拾うと附則が本則を上書きし、5条が「政令への委任」になる。
    # MainProvision の中だけを読む。
    def rec(n):
        if isinstance(n,dict) and n.get('tag')=='SupplProvision': return
        if isinstance(n,dict):
            if n.get('tag')=='Article':
                num=n.get('attr',{}).get('Num','')
                cap=''
                body=[]
                for c in n.get('children') or []:
                    tg=c.get('tag') if isinstance(c,dict) else None
                    if tg=='ArticleCaption': cap=text(c)
                    elif tg=='ArticleTitle': pass
                    elif tg=='Paragraph': body.append(text(c))
                out[num]={'caption':cap,'paras':body}
            for c in (n.get('children') or []): rec(c)
        elif isinstance(n,list):
            for c in n: rec(c)
    rec(d['law_full_text'])
    return out
if __name__=='__main__':
    law=sys.argv[1]; nums=sys.argv[2:]
    A=articles(law)
    if not nums:
        print(f'{law}: {len(A)}条  例:',list(A)[:12]); sys.exit()
    for q in nums:
        a=A.get(q)
        print(f'\n===== {law} 第{q}条 {a["caption"] if a else "（無し）"} =====')
        if a:
            for i,p in enumerate(a['paras'],1): print(f'  {i}項 {p[:600]}')

# 使い方:
#   python scripts/law-article.py 行政手続法 5 8 13
# 事前に e-Gov 法令API v2 から .dat を落としておく（このスクリプトと同じ場所）:
#   https://laws.e-gov.go.jp/api/2/law_data/{法令ID}?response_format=json
# **附則には本則と同じ条番号がある。SupplProvision を飛ばさないと本則が上書きされる。**
